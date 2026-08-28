/**
 * RWT-WS-002 regression test:
 *
 * A duplicate tunnel ID connecting while an existing connection is OPEN
 * must be rejected with close code 1008. The existing connection must
 * not be disrupted.
 */
const WebSocket = require('ws');
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const { startWebSocketServer, stopWebSocketServer } = require('../../server/websocketServer');
const { MESSAGE_TYPE_CONFIG, MESSAGE_TYPE_DATA } = require('../../server/constants');
const state = require('../../server/state');
const { getFreePort } = require('../helpers/integrationHarness');

jest.setTimeout(30000);

function pad36(s) {
  if (s.length > 36) return s.slice(0, 36);
  return s.padEnd(36, '\0');
}

function buildConfigFrame(tunnelId, uuid, port) {
  const payload = Buffer.from(JSON.stringify({ TUNNEL_ENTRY_PORT: port }), 'utf8');
  const totalLength = 73 + payload.length;
  const buf = Buffer.allocUnsafe(4 + totalLength);
  buf.writeUInt32BE(totalLength, 0);
  buf.write(pad36(tunnelId), 4, 36, 'utf8');
  buf.write(pad36(uuid), 4 + 36, 36, 'utf8');
  buf.writeUInt8(MESSAGE_TYPE_CONFIG, 4 + 72);
  payload.copy(buf, 4 + 73);
  return buf;
}

function serverTunnelState(wsPort, tid) {
  const padded = pad36(tid);
  return state[String(wsPort)]?.websocketTunnels?.[padded];
}

function createRawWs(url) {
  const ws = new WebSocket(url);

  const open = new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onClose = code => {
      cleanup();
      reject(new Error(`ws closed before open: ${code}`));
    };
    const onError = err => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      ws.removeListener('open', onOpen);
      ws.removeListener('close', onClose);
      ws.removeListener('error', onError);
    };
    ws.on('open', onOpen);
    ws.on('close', onClose);
    ws.on('error', onError);
  });

  const close = new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) {
      return resolve({ code: ws._closeCode || 1000 });
    }
    if (ws.readyState === WebSocket.CLOSING) {
      return resolve({ code: ws._closeCode || 1000 });
    }
    const timer = setTimeout(() => reject(new Error('ws did not close')), 5000);
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    ws.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });

  return { ws, open, close };
}

function waitForState(wsPort, tid, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (serverTunnelState(wsPort, tid)) return resolve();
    const deadline = setTimeout(() => reject(new Error('tunnel not registered')), timeoutMs);
    const poll = setInterval(() => {
      if (serverTunnelState(wsPort, tid)) {
        clearTimeout(deadline);
        clearInterval(poll);
        resolve();
      }
    }, 20);
  });
}

describe('RWT-WS-002 duplicate tunnel ID rejection', () => {
  let wsPort;
  let entryPort;
  const tunnelId = `dup-test-${uuidv4()}`;
  let rawTarget;

  beforeAll(async () => {
    wsPort = await getFreePort();
    entryPort = await getFreePort();

    rawTarget = net.createServer(socket => socket.end('echo'));
    rawTarget.on('connection', socket => socket.unref());
    await new Promise(resolve => rawTarget.listen(entryPort, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise(resolve => rawTarget.close(resolve));
  });

  afterEach(async () => {
    await stopWebSocketServer(wsPort);
    delete state[String(wsPort)];
  });

  test('second connection with same tunnelId is closed with 1008; first stays OPEN', async () => {
    startWebSocketServer({
      port: wsPort,
      host: '127.0.0.1',
      path: '/tunnel',
      tunnelIdHeaderName: 'x-tunnel-id',
    });

    // Connection 1 — establish tunnel
    const { ws: ws1, open: open1 } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    await open1;
    ws1.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
    await waitForState(wsPort, tunnelId);

    // Server-side ws for connection 1 is OPEN
    const serverWs1 = serverTunnelState(wsPort, tunnelId).ws;
    expect(serverWs1.readyState).toBe(WebSocket.OPEN);

    // Connection 2 — same tunnelId, should be rejected
    const { ws: ws2, open: open2, close: close2 } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    const { code } = await Promise.race([
      close2,
      open2.then(() => {
        ws2.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
        return close2;
      }),
    ]);
    expect(code).toBe(1008);

    // Connection 1 was not disrupted — server-side ws still OPEN
    expect(serverWs1.readyState).toBe(WebSocket.OPEN);
    expect(serverTunnelState(wsPort, tunnelId)).toBeDefined();
    expect(serverTunnelState(wsPort, tunnelId).ws).toBe(serverWs1);

    ws1.close();
    await new Promise(resolve => ws1.on('close', resolve));
  });

  test('second connection rejected does not replace first in state', async () => {
    startWebSocketServer({
      port: wsPort,
      host: '127.0.0.1',
      path: '/tunnel',
      tunnelIdHeaderName: 'x-tunnel-id',
    });

    const { ws: ws1, open: open1 } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    await open1;
    ws1.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
    await waitForState(wsPort, tunnelId);

    const wsRefBefore = serverTunnelState(wsPort, tunnelId).ws;

    // Connection 2 — rejected
    const { ws: ws2, open: open2, close: close2 } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    await Promise.race([
      close2,
      open2.then(() => {
        ws2.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
        return close2;
      }),
    ]);

    // State still points to connection 1's server-side ws
    expect(serverTunnelState(wsPort, tunnelId).ws).toBe(wsRefBefore);

    ws1.close();
    await new Promise(resolve => ws1.on('close', resolve));
  });

  test('tunnel state intact after duplicate rejection', async () => {
    startWebSocketServer({
      port: wsPort,
      host: '127.0.0.1',
      path: '/tunnel',
      tunnelIdHeaderName: 'x-tunnel-id',
    });

    const { ws: ws1, open: open1 } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    await open1;
    ws1.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
    await waitForState(wsPort, tunnelId);

    const serverWs1 = serverTunnelState(wsPort, tunnelId).ws;
    expect(serverWs1.readyState).toBe(WebSocket.OPEN);

    // Connection 2 — rejected
    const { ws: ws2, open: open2, close: close2 } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    await Promise.race([
      close2,
      open2.then(() => {
        ws2.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
        return close2;
      }),
    ]);

    // First connection's state is fully intact
    const tunnel = serverTunnelState(wsPort, tunnelId);
    expect(tunnel).toBeDefined();
    expect(tunnel.ws).toBe(serverWs1);
    expect(tunnel.ws.readyState).toBe(WebSocket.OPEN);
    expect(tunnel.tcpConnections).toBeDefined();
    expect(typeof tunnel.tcpConnections).toBe('object');

    ws1.close();
    await new Promise(resolve => ws1.on('close', resolve));
  });

  test('connection closed before CONFIG does not corrupt state', async () => {
    startWebSocketServer({
      port: wsPort,
      host: '127.0.0.1',
      path: '/tunnel',
      tunnelIdHeaderName: 'x-tunnel-id',
    });

    const { ws: ws1, open: open1 } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    await open1;
    ws1.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
    await waitForState(wsPort, tunnelId);

    const serverWs1 = serverTunnelState(wsPort, tunnelId).ws;

    // Connection 2 opens but closes immediately — no CONFIG sent
    const { ws: ws2, open: open2 } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    await open2;
    ws2.close();
    await new Promise(resolve => ws2.on('close', resolve));

    // State still clean — first tunnel unaffected
    expect(serverTunnelState(wsPort, tunnelId)).toBeDefined();
    expect(serverTunnelState(wsPort, tunnelId).ws).toBe(serverWs1);
    expect(serverWs1.readyState).toBe(WebSocket.OPEN);

    ws1.close();
    await new Promise(resolve => ws1.on('close', resolve));
  });
});

/**
 * RWT-KNOWN-012 regression test:
 *
 * When a duplicate WebSocket B connects with the same tunnelId as an
 * existing tunnel A, B's cleanup() must NOT destroy A's TCP connections.
 * The ownership guard (registeredTunnel.ws === ws) must protect both
 * TCP connection teardown AND state deletion.
 */
describe('RWT-KNOWN-012 duplicate cleanup must not destroy existing tunnel resources', () => {
  let wsPort;
  let entryPort;

  beforeAll(async () => {
    wsPort = await getFreePort();
    entryPort = await getFreePort();
  });

  afterEach(async () => {
    await stopWebSocketServer(wsPort);
    delete state[String(wsPort)];
  });

  test('duplicate rejection preserves existing tunnel state', async () => {
    const tunnelId = `dup-known012-${uuidv4()}`;

    startWebSocketServer({
      port: wsPort,
      host: '127.0.0.1',
      path: '/tunnel',
      tunnelIdHeaderName: 'x-tunnel-id',
    });

    // 1. Connect tunnel A and send CONFIG
    const { ws: wsA, open: openA } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    await openA;
    wsA.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
    await waitForState(wsPort, tunnelId);

    // 2. Verify tunnel A is registered
    const tunnel = serverTunnelState(wsPort, tunnelId);
    expect(tunnel).toBeDefined();
    const serverWsBefore = tunnel.ws;
    expect(serverWsBefore.readyState).toBe(WebSocket.OPEN);
    expect(tunnel.tcpConnections).toBeDefined();

    // 3. Connect duplicate tunnel B with the same tunnelId
    const { ws: wsB, open: openB, close: closeB } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    const { code } = await Promise.race([
      closeB,
      openB.then(() => {
        wsB.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
        return closeB;
      }),
    ]);

    // 4. Verify B was rejected with 1008
    expect(code).toBe(1008);

    // 5. Wait for B's cleanup to fully complete
    await new Promise(resolve => setTimeout(resolve, 200));

    // 6. Verify A's tunnel is still registered and intact
    const tunnelAfterDup = serverTunnelState(wsPort, tunnelId);
    expect(tunnelAfterDup).toBeDefined();
    expect(tunnelAfterDup.ws).toBe(serverWsBefore);
    expect(tunnelAfterDup.ws.readyState).toBe(WebSocket.OPEN);

    // 7. Verify tcpConnections dict survived (not nulled or destroyed)
    expect(tunnelAfterDup.tcpConnections).toBeDefined();
    expect(typeof tunnelAfterDup.tcpConnections).toBe('object');

    // 8. Cleanup
    wsA.close();
    await new Promise(resolve => wsA.on('close', resolve));
  });

  test('repeated duplicate rejections do not destroy existing tunnel', async () => {
    const tunnelId = `dup-repeat-${uuidv4()}`;

    startWebSocketServer({
      port: wsPort,
      host: '127.0.0.1',
      path: '/tunnel',
      tunnelIdHeaderName: 'x-tunnel-id',
    });

    // Connect tunnel A
    const { ws: wsA, open: openA } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    await openA;
    wsA.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
    await waitForState(wsPort, tunnelId);

    const tunnelBefore = serverTunnelState(wsPort, tunnelId);
    expect(tunnelBefore).toBeDefined();
    const serverWsBefore = tunnelBefore.ws;
    expect(serverWsBefore.readyState).toBe(WebSocket.OPEN);

    // Send 3 duplicate connections in rapid succession
    for (let i = 0; i < 3; i++) {
      const {
        ws: wsDup,
        open: openDup,
        close: closeDup,
      } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
      const { code } = await Promise.race([
        closeDup,
        openDup.then(() => {
          wsDup.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
          return closeDup;
        }),
      ]);
      expect(code).toBe(1008);
    }

    // Wait for all cleanup to settle
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify A is still intact — same server-side ws, still OPEN
    const tunnelAfter = serverTunnelState(wsPort, tunnelId);
    expect(tunnelAfter).toBeDefined();
    expect(tunnelAfter.ws).toBe(serverWsBefore);
    expect(tunnelAfter.ws.readyState).toBe(WebSocket.OPEN);

    wsA.close();
    await new Promise(resolve => wsA.on('close', resolve));
  });

  test('owner cleanup still removes tunnel from state', async () => {
    const tunnelId = `dup-owner-${uuidv4()}`;

    startWebSocketServer({
      port: wsPort,
      host: '127.0.0.1',
      path: '/tunnel',
      tunnelIdHeaderName: 'x-tunnel-id',
    });

    // Connect tunnel A
    const { ws: wsA, open: openA } = createRawWs(`ws://127.0.0.1:${wsPort}/tunnel`);
    await openA;
    wsA.send(buildConfigFrame(tunnelId, uuidv4(), entryPort));
    await waitForState(wsPort, tunnelId);

    const tunnelBefore = serverTunnelState(wsPort, tunnelId);
    expect(tunnelBefore).toBeDefined();

    // Now close tunnel A — its cleanup SHOULD remove it from state
    wsA.close();
    await new Promise(resolve => wsA.on('close', resolve));

    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify tunnel A is removed from state
    expect(serverTunnelState(wsPort, tunnelId)).toBeUndefined();
  });
});

/**
 * Regression tests for RWT-KNOWN-005 and RWT-KNOWN-007.
 *
 * KNOWN-005: cleanup() must be exception-safe (try/finally) and
 *   idempotent so that double-invocation from error+close events
 *   does not hang WebSocket.Server.close().
 *
 * KNOWN-007: harness close() must await stopWebSocketServer() so
 *   that the WS server port is released before close() resolves.
 */
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { startHarness } = require('../helpers/integrationHarness');
const { startWebSocketServer, stopWebSocketServer } = require('../../server/websocketServer');
const { connectWebSocket, resetClients } = require('../../client/tunnelClient');
const state = require('../../server/state');

jest.setTimeout(30000);

function isPortListening(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', err => {
      resolve(err.code === 'EADDRINUSE');
    });
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(false));
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

describe('harness close awaits stopWebSocketServer (RWT-KNOWN-007)', () => {
  test('WS server port is no longer listening after close() resolves', async () => {
    const h = await startHarness();
    await h.waitReady();

    const port = h.wsPort;

    // Server must be listening while harness is alive.
    expect(await isPortListening(port)).toBe(true);

    await h.close();

    // After close() resolves, the port must be free.
    expect(await isPortListening(port)).toBe(false);
  });

  test('consecutive harnesses do not leak ports', async () => {
    const ports = [];

    for (let i = 0; i < 3; i++) {
      const h = await startHarness();
      await h.waitReady();
      ports.push(h.wsPort);
      await h.close();
    }

    // All three ports must be free after their respective harnesses closed.
    for (const port of ports) {
      expect(await isPortListening(port)).toBe(false);
    }
  });
});

describe('WS error/termination cleans registry (RWT-KNOWN-005)', () => {
  test('ws.terminate() triggers cleanup, clears tunnel state, and stopWebSocketServer resolves', async () => {
    const wsPort = await getFreePort();
    const entryPort = await getFreePort();
    const tunnelId = crypto.randomUUID();

    const target = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(Buffer.concat(chunks));
      });
    });
    await new Promise(r => target.listen(0, '127.0.0.1', r));
    const targetPort = target.address().port;

    startWebSocketServer({
      port: wsPort,
      host: '127.0.0.1',
      path: '/tunnel',
      tunnelIdHeaderName: 'x-tunnel-id',
    });

    const client = connectWebSocket({
      targetUrl: `http://127.0.0.1:${targetPort}`,
      wsUrl: `ws://127.0.0.1:${wsPort}/tunnel`,
      tunnelId,
      targetPort,
      tunnelEntryPort: entryPort,
      autoReconnect: false,
    });

    // Wait until the tunnel answers end-to-end.
    for (let i = 0; i < 60; i++) {
      try {
        const r = await new Promise((resolve, reject) => {
          const req = http.request(
            { host: '127.0.0.1', port: entryPort, path: '/echo', method: 'GET',
              headers: { 'x-tunnel-id': tunnelId } },
            res => {
              const chunks = [];
              res.on('data', c => chunks.push(c));
              res.on('end', () => resolve({ status: res.statusCode }));
            }
          );
          req.setTimeout(400, () => req.destroy(new Error('probe')));
          req.on('error', reject);
          req.end();
        });
        if (r.status === 200) break;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 100));
    }

    // Tunnel must be registered in state before the terminate.
    const tunnelBefore = state[String(wsPort)]?.websocketTunnels?.[tunnelId];
    expect(tunnelBefore).toBeDefined();

    // Forcefully terminate the WS — simulates a client crash.
    // This fires the 'error' handler on the server side (RWT-KNOWN-005 path).
    client.close();

    // Wait for cleanup to run (WS close event + cleanup execution).
    await new Promise(r => setTimeout(r, 500));

    // After cleanup, the tunnel must be removed from state.
    const tunnelAfter = state[String(wsPort)]?.websocketTunnels?.[tunnelId];
    expect(tunnelAfter).toBeUndefined();

    // stopWebSocketServer must resolve (not hang).
    // If the server's clients Set still held the dead connection,
    // close() would never call its callback.
    await stopWebSocketServer(wsPort);

    // WS port must be free.
    expect(await isPortListening(wsPort)).toBe(false);

    // Cleanup remaining resources.
    await new Promise(r => setTimeout(r, 200));
    resetClients();
    await new Promise(r => target.close(r));
  });

  test('cleanup called twice (error then close) is idempotent', async () => {
    const wsPort = await getFreePort();
    const entryPort = await getFreePort();
    const tunnelId = crypto.randomUUID();

    const target = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200);
        res.end(Buffer.concat(chunks));
      });
    });
    await new Promise(r => target.listen(0, '127.0.0.1', r));
    const targetPort = target.address().port;

    startWebSocketServer({
      port: wsPort,
      host: '127.0.0.1',
      path: '/tunnel',
      tunnelIdHeaderName: 'x-tunnel-id',
    });

    const client = connectWebSocket({
      targetUrl: `http://127.0.0.1:${targetPort}`,
      wsUrl: `ws://127.0.0.1:${wsPort}/tunnel`,
      tunnelId,
      targetPort,
      tunnelEntryPort: entryPort,
      autoReconnect: false,
    });

    // Wait until ready.
    for (let i = 0; i < 60; i++) {
      try {
        const r = await new Promise((resolve, reject) => {
          const req = http.request(
            { host: '127.0.0.1', port: entryPort, path: '/echo', method: 'GET',
              headers: { 'x-tunnel-id': tunnelId } },
            res => {
              const chunks = [];
              res.on('data', c => chunks.push(c));
              res.on('end', () => resolve({ status: res.statusCode }));
            }
          );
          req.setTimeout(400, () => req.destroy(new Error('probe')));
          req.on('error', reject);
          req.end();
        });
        if (r.status === 200) break;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 100));
    }

    // Send an active TCP connection so cleanup has real sockets to destroy.
    const postBody = crypto.randomBytes(1024);
    const postResult = new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: entryPort, path: '/echo', method: 'POST',
          headers: { 'x-tunnel-id': tunnelId, 'content-length': String(postBody.length) } },
        res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
        }
      );
      req.setTimeout(5000, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.write(postBody);
      req.end();
    });

    // Let the POST flow, then terminate — cleanup must not throw.
    await new Promise(r => setTimeout(r, 100));
    client.close();

    // If cleanup throws (RWT-KNOWN-005), stopWebSocketServer would hang
    // because the server's clients Set retains the dead connection.
    // The try/finally in cleanup ensures ws.terminate() always runs,
    // which allows the ws library's internal close handler to de-register.
    const closeResult = await Promise.race([
      stopWebSocketServer(wsPort).then(() => 'resolved'),
      new Promise(r => setTimeout(() => r('timed-out'), 10000)),
    ]);
    expect(closeResult).toBe('resolved');

    // WS port must be free.
    expect(await isPortListening(wsPort)).toBe(false);

    // Wait for the client's WS close event to fire so winston doesn't
    // crash after Jest tears down the environment.
    await new Promise(r => setTimeout(r, 200));
    resetClients();
    await new Promise(r => target.close(r));

    // Consume the post result if it arrived (may have been interrupted).
    try { await postResult; } catch (_) {}
  });
});

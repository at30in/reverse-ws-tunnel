/**
 * Integration harness: spins up a real echo HTTP target, a real WSS and a
 * real tunnel client on free ports. Requires RWT_* env vars (when used) to
 * be set BEFORE the first require of this module: server/client limits are
 * resolved once per process at load time.
 */
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { startWebSocketServer, stopWebSocketServer } = require('../../server/websocketServer');
const { connectWebSocket } = require('../../client/tunnelClient');
const { resetClients } = require('../../client/tunnelClient');

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

function defaultEcho(req, res) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(body);
  });
}

async function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
}

async function startHarness({ targetHandler = defaultEcho } = {}) {
  const [wsPort, entryPort] = await Promise.all([getFreePort(), getFreePort()]);
  const tunnelId = crypto.randomUUID();

  const target = http.createServer(targetHandler);
  await listen(target);
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

  async function rawReq(method, body, { headers = {}, timeoutMs = 60000, onResponse } = {}) {
    return new Promise((resolve, reject) => {
      const cl = body ? { 'content-length': String(body.length) } : {};
      const req = http.request(
        {
          host: '127.0.0.1',
          port: entryPort,
          path: '/echo',
          method,
          headers: { 'x-tunnel-id': tunnelId, ...cl, ...headers },
        },
        res => {
          if (onResponse) onResponse(res);
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode, body: Buffer.concat(chunks), res })
          );
        }
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`rawReq timeout after ${timeoutMs}ms`));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  // Wait until the tunnel answers end-to-end.
  async function waitReady({ attempts = 60, delayMs = 100 } = {}) {
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await Promise.race([
          rawReq('GET'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('probe')), 400)),
        ]);
        if (r.status === 200) return;
      } catch (_) {}
      await new Promise(r => setTimeout(r, delayMs));
    }
    throw new Error('tunnel did not become ready');
  }

  async function close() {
    try {
      client.close();
    } catch (_) {}
    try {
      stopWebSocketServer();
    } catch (_) {}
    resetClients();
    await new Promise(r => target.close(r));
    // Give sockets a beat to release ports.
    await new Promise(r => setTimeout(r, 50));
  }

  return { wsPort, entryPort, targetPort, tunnelId, client, rawReq, waitReady, close };
}

/**
 * Samples values produced by fn() every intervalMs while fnCollect runs,
 * returning the maximum observed value. Used to assert bounded buffering.
 */
async function samplePeak(fn, intervalMs = 25) {
  let peak = 0;
  const timer = setInterval(() => {
    try {
      const v = fn();
      if (typeof v === 'number' && v > peak) peak = v;
    } catch (_) {}
  }, intervalMs);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      return peak;
    },
  };
}

module.exports = { startHarness, getFreePort, samplePeak, defaultEcho };

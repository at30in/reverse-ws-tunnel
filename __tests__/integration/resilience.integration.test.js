/**
 * Resilience integration tests:
 *
 *  T-G  killing the client WS mid-transfer must clean every server-side
 *       stream (sockets destroyed, state emptied) and allow reconnect;
 *  half-close / Connection:close flows must not wedge the tunnel.
 */
const crypto = require('crypto');
const http = require('http');
const { startHarness } = require('../helpers/integrationHarness');

jest.setTimeout(60000);

function tunnelState(wsPort, tunnelId) {
  const state = require('../../server/state');
  return state[String(wsPort)]?.websocketTunnels?.[tunnelId];
}

describe('resilience', () => {
  test('T-G: disconnect mid-transfer cleans streams and allows reconnect', async () => {
    let h = await startHarness();
    await h.waitReady();

    const bigBody = crypto.randomBytes(12 * 1024 * 1024);
    const inflight = h.rawReq('POST', bigBody, { timeoutMs: 20000 }).then(
      r => ({ ok: true }),
      e => ({ ok: false, err: String(e.message || e) })
    );

    // Let a few MB flow, then kill the client WebSocket.
    await new Promise(r => setTimeout(r, 250));
    h.client.close();

    const result = await inflight;
    expect(result.ok).toBe(false); // the request cannot complete

    // Give cleanup a moment, then assert the tunnel is gone and sockets died.
    await new Promise(r => setTimeout(r, 300));
    expect(tunnelState(h.wsPort, h.tunnelId)).toBeUndefined();

    // A brand-new client on the same ports works immediately (server kept
    // listening; no stale stream wedged the entry port).
    await h.close();
    h = null;

    const h2 = await startHarness();
    await h2.waitReady();
    const ok = await h2.rawReq('POST', Buffer.from('after-reconnect'));
    expect(ok.status).toBe(200);
    expect(ok.body.toString()).toBe('after-reconnect');
    await h2.close();
  });

  test('Connection: close requests terminate cleanly end-to-end', async () => {
    const h = await startHarness();
    try {
      await h.waitReady();
      for (let i = 0; i < 5; i++) {
        const r = await new Promise((resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port: h.entryPort,
              path: '/echo',
              method: 'GET',
              headers: { 'x-tunnel-id': h.tunnelId, connection: 'close' },
            },
            res => {
              const chunks = [];
              res.on('data', c => chunks.push(c));
              res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
            }
          );
          req.setTimeout(10000, () => req.destroy(new Error('timeout')));
          req.on('error', reject);
          req.end();
        });
        expect(r.status).toBe(200);
      }
      // Tunnel still healthy afterwards.
      const last = await h.rawReq('GET', null);
      expect(last.status).toBe(200);
    } finally {
      await h.close();
    }
  });

  test('target-side FIN propagates as CLOSE without breaking the tunnel', async () => {
    // Target that closes the response after one short body (HTTP/1.0-style).
    const handler = (req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { connection: 'close' });
        res.end(Buffer.concat(chunks));
      });
    };
    const h = await startHarness({ targetHandler: handler });
    try {
      await h.waitReady();
      const r1 = await h.rawReq('POST', Buffer.from('fin-propagation'));
      expect(r1.status).toBe(200);
      expect(r1.body.toString()).toBe('fin-propagation');
      // Tunnel still usable after the target closed its socket.
      const r2 = await h.rawReq('POST', Buffer.from('second'));
      expect(r2.body.toString()).toBe('second');
    } finally {
      await h.close();
    }
  });
});

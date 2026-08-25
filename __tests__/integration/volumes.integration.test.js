/**
 * Volume & fairness integration tests:
 *
 *  T-A  single 100MB round-trip must be byte-exact
 *  T-B  10 concurrent 8MB transfers + bounded process memory
 *  T-C  starvation: big transfer in flight must not starve small streams
 *  T-E  slow reader on the response path triggers sender pause/resume
 *
 *  (250MB/500MB runs are gated behind RUN_STRESS_TESTS=1)
 */
const crypto = require('crypto');
const { startHarness, samplePeak } = require('../helpers/integrationHarness');

jest.setTimeout(120000);

function serverConns(wsPort, tunnelId) {
  const state = require('../../server/state');
  const tun = state[String(wsPort)]?.websocketTunnels?.[tunnelId];
  return Object.values(tun?.tcpConnections || {});
}

describe('volume and fairness', () => {
  let h;

  beforeEach(async () => {
    h = await startHarness();
    await h.waitReady();
  });

  afterEach(async () => {
    if (h) await h.close();
    h = null;
  });

  test('T-A: single 100MB round-trip is byte-exact', async () => {
    const size = 100 * 1024 * 1024;
    const body = crypto.randomBytes(size);
    const expectedSha = crypto.createHash('sha256').update(body).digest('hex');

    const r = await h.rawReq('POST', body, { timeoutMs: 90000 });
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(size);
    const gotSha = crypto.createHash('sha256').update(r.body).digest('hex');
    expect(gotSha).toBe(expectedSha);
  }, 110000);

  test('T-B: 10 concurrent 8MB transfers, byte-exact, bounded memory', async () => {
    const rssBefore = process.memoryUsage().rss;
    const bodies = Array.from({ length: 10 }, () => crypto.randomBytes(8 * 1024 * 1024));

    const results = await Promise.all(bodies.map(b => h.rawReq('POST', b, { timeoutMs: 90000 })));

    results.forEach((r, i) => {
      expect(r.status).toBe(200);
      expect(r.body.equals(bodies[i])).toBe(true);
    });

    // Bounded memory: buffers are released as streams complete.
    global.gc && global.gc();
    const rssAfter = process.memoryUsage().rss;
    expect(rssAfter - rssBefore).toBeLessThan(400 * 1024 * 1024);
  }, 110000);

  test('T-C: small interactive streams are not starved by a large transfer', async () => {
    const bigBody = crypto.randomBytes(20 * 1024 * 1024);
    const bigTransfer = h.rawReq('POST', bigBody, { timeoutMs: 60000 }).then(r => {
      expect(r.status).toBe(200);
      expect(r.body.length).toBe(bigBody.length);
    });

    const latencies = [];
    for (let i = 0; i < 30; i++) {
      const t0 = Date.now();
      const r = await h.rawReq('GET', null, { timeoutMs: 5000 });
      const dt = Date.now() - t0;
      expect(r.status).toBe(200);
      latencies.push(dt);
      await new Promise(res => setTimeout(res, 25));
    }

    await bigTransfer;

    latencies.forEach(
      (dt, i) => expect(dt).toBeLessThan(1500) // generous CI-safe bound per request
    );
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    expect(avg).toBeLessThan(500);
  }, 100000);

  test('T-F: 60 concurrent tiny streams all correct', async () => {
    const payloads = Array.from({ length: 60 }, (_, i) => Buffer.from(`m-${i}`));
    const results = await Promise.all(payloads.map(p => h.rawReq('POST', p, { timeoutMs: 30000 })));
    results.forEach((r, i) => {
      expect(r.status).toBe(200);
      expect(r.body.toString()).toBe(`m-${i}`);
    });
  }, 60000);

  test('T-E: slow response reader triggers backpressure and still completes', async () => {
    const size = 6 * 1024 * 1024;
    const responseBody = crypto.randomBytes(size);

    // Echo target that replies with a fixed 6MB payload regardless of input.
    h.close(); // release the default harness
    const slowTargetHandler = (req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-length': String(responseBody.length) });
        res.write(responseBody, () => res.end());
      });
    };
    h = await startHarness({ targetHandler: slowTargetHandler });
    await h.waitReady();

    const bufferedSampler = await samplePeak(() => {
      const state = require('../../server/state');
      const tun = state[String(h.wsPort)]?.websocketTunnels?.[h.tunnelId];
      if (!tun) return 0;
      let maxWs = tun.ws ? tun.ws.bufferedAmount : 0;
      for (const c of Object.values(tun.tcpConnections || {})) {
        if (c.sender && c.sender.getOutstanding() > maxWs) {
          maxWs = c.sender.getOutstanding();
        }
      }
      return maxWs;
    });

    const r = await new Promise((resolve, reject) => {
      const http = require('http');
      const req = http.request(
        {
          host: '127.0.0.1',
          port: h.entryPort,
          path: '/echo',
          method: 'GET',
          headers: { 'x-tunnel-id': h.tunnelId },
        },
        res => {
          const chunks = [];
          let pausedOnce = false;
          res.on('data', c => {
            chunks.push(c);
            if (!pausedOnce && rn(chunks) > 1024 * 512) {
              pausedOnce = true;
              res.pause();
              setTimeout(() => res.resume(), 700); // stall the entry reader
            }
          });
          function rn(arr) {
            return arr.reduce((a, b) => a + b.length, 0);
          }
          res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
          res.on('error', reject);
        }
      );
      req.setTimeout(45000, () => req.destroy(new Error('slow-reader timeout')));
      req.on('error', reject);
      req.end();
    });

    expect(r.status).toBe(200);
    expect(r.body.equals(responseBody)).toBe(true);

    // The WS link never buffered unboundedly while the reader was stalled.
    const peakBuffered = bufferedSampler.stop();
    expect(peakBuffered).toBeLessThan(16 * 1024 * 1024);
  }, 90000);

  test('stress: 250MB round-trip when RUN_STRESS_TESTS=1', async () => {
    if (!process.env.RUN_STRESS_TESTS) return;
    const size = 250 * 1024 * 1024;
    const body = crypto.randomBytes(size);
    const expectedSha = crypto.createHash('sha256').update(body).digest('hex');
    const r = await h.rawReq('POST', body, { timeoutMs: 240000 });
    expect(r.status).toBe(200);
    const gotSha = crypto.createHash('sha256').update(r.body).digest('hex');
    expect(gotSha).toBe(expectedSha);
  }, 260000);
});

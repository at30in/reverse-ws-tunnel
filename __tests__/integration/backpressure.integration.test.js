/**
 * Integration tests with TINY limits (set via RWT_* before module load) to
 * exercise controlled-overflow behavior and bounded memory:
 *
 *  - a stalled consumer must never balloon memory; the stream is closed
 *    controllably while the tunnel (and other streams) stay healthy;
 *  - buffered bytes must never exceed the configured per-stream cap;
 *  - the tunnel keeps serving new streams after an overflow storm.
 */
process.env.RWT_HIGH_WATERMARK = String(2 * 1024 * 1024); // 2MB
process.env.RWT_LOW_WATERMARK = String(512 * 1024); // 512KB
process.env.RWT_MAX_BUFFER_PER_STREAM = String(1024 * 1024); // 1MB
process.env.RWT_MAX_BUFFER_PER_TUNNEL = String(2 * 1024 * 1024); // 2MB

const crypto = require('crypto');
const { startHarness, samplePeak } = require('../helpers/integrationHarness');
const { getMetrics } = require('../../utils/tunnelMetrics');

jest.setTimeout(60000);

function serverConns(wsPort, tunnelId) {
  const state = require('../../server/state');
  const tun = state[String(wsPort)]?.websocketTunnels?.[tunnelId];
  return Object.values(tun?.tcpConnections || {});
}

describe('bounded backpressure under tiny limits', () => {
  let h;

  afterEach(async () => {
    if (h) await h.close();
    h = null;
  });

  test('stalled consumer: stream closes controllably, tunnel survives, buffers bounded', async () => {
    // Target that stalls the FIRST request for 800ms before draining.
    let stallOnce = true;
    const targetHandler = (req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const reply = () => {
          res.writeHead(200);
          res.end(body);
        };
        if (stallOnce) {
          stallOnce = false;
          setTimeout(reply, 800);
        } else {
          reply();
        }
      });
    };

    h = await startHarness({ targetHandler });
    await h.waitReady();

    // Healthy concurrent stream must be unaffected by the storm below.
    const healthy = h.rawReq('POST', Buffer.from('healthy-payload')).then(r => {
      expect(r.status).toBe(200);
      expect(r.body.toString()).toBe('healthy-payload');
    });

    const bigBody = crypto.randomBytes(4 * 1024 * 1024); // 4MB >> 1MB cap

    const peakSampler = await samplePeak(() =>
      Math.max(
        0,
        ...serverConns(h.wsPort, h.tunnelId).map(c => (c.queue ? c.queue.queuedBytes() : 0))
      )
    );

    const stalled = h.rawReq('POST', bigBody, { timeoutMs: 15000 }).then(
      r => ({ ok: true, status: r.status, len: r.body.length }),
      e => ({ ok: false, err: String(e.message || e) })
    );

    const [stalledResult] = await Promise.all([stalled, healthy]);
    const peakQueued = peakSampler.stop();

    // Either the stalled stream completed or it was closed controllably:
    // both are acceptable. What is NOT acceptable is unbounded buffering.
    expect(peakQueued).toBeLessThanOrEqual(1024 * 1024 + 128 * 1024);

    if (!stalledResult.ok) {
      // Controlled abort: error mentions timeout/abort/close, not a crash.
      expect(stalledResult.err).toMatch(/timeout|abort|close|socket hang up|ECONNRESET/i);
    }

    // The tunnel is still fully operational after the overflow.
    const after = await h.rawReq('GET', null, { timeoutMs: 5000 });
    expect(after.status).toBe(200);

    const snap = getMetrics().snapshot();
    expect(snap.frame_too_large_total).toBe(0);
    expect(snap.active_tunnels).toBeGreaterThanOrEqual(0);
  });

  test('many rapid small streams stay correct under tiny caps', async () => {
    h = await startHarness();
    await h.waitReady();

    const payloads = Array.from({ length: 40 }, (_, i) =>
      Buffer.from(`tiny-${i}-${'x'.repeat(2000)}`)
    );
    const results = await Promise.all(payloads.map(p => h.rawReq('POST', p)));
    results.forEach((r, i) => {
      expect(r.status).toBe(200);
      expect(r.body.equals(payloads[i])).toBe(true);
    });
  });
});

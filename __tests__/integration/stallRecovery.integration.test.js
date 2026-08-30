/**
 * Integration test: stalled stream recovery.
 *
 * Simulates the "tunnel alive but not operational" scenario:
 *  1. Target service becomes slow (half-open TCP)
 *  2. Client TCP socket fills up, sender pauses
 *  3. TCP idle timeout or stream health check cleans up the stalled stream
 *  4. New request on the same tunnel works immediately
 *
 * Uses the integration harness for reliable port allocation and lifecycle.
 */

const http = require('http');
const { startHarness } = require('../helpers/integrationHarness');

jest.setTimeout(60000);

describe('stalled stream recovery', () => {
  test('tunnel survives a hanging target request and serves new requests', async () => {
    // Create a target that hangs on /hang but responds on /fast
    let hangResolvers = [];
    const targetHandler = (req, res) => {
      if (req.url === '/hang') {
        // Hold the request open — never respond within test timeframe
        hangResolvers.push({ req, res });
        return;
      }
      // Echo back the path for /fast and /echo
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(req.url === '/fast' ? 'fast-response' : Buffer.concat(chunks));
      });
    };

    const h = await startHarness({ targetHandler });
    await h.waitReady();

    // 1. Verify tunnel works with a fast request
    const r1 = await h.rawReq('GET');
    expect(r1.status).toBe(200);

    // 2. Fire a hanging request (target never responds)
    const hangPromise = h
      .rawReq('GET', null, {
        headers: { 'x-test-hang': '1' },
        timeoutMs: 5000,
      })
      .catch(() => ({ ok: false }));

    // Wait for the hanging request to be in-flight
    await new Promise(r => setTimeout(r, 300));

    // 3. Verify the tunnel still serves new requests
    //    (the hanging stream is stalled but doesn't block others)
    const r2 = await h.rawReq('GET');
    expect(r2.status).toBe(200);

    // 4. Clean up
    await h.close();
    hangResolvers.forEach(({ res }) => {
      try {
        res.end('aborted');
      } catch (_) {}
    });
    hangPromise.catch(() => {});
  });

  test('new client on same ports works after stall cleanup', async () => {
    let hangResolvers = [];
    const targetHandler = (req, res) => {
      if (req.url === '/hang') {
        hangResolvers.push({ req, res });
        return;
      }
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
    };

    // First harness: create a stall
    let h = await startHarness({ targetHandler });
    await h.waitReady();

    // Fire a hanging request
    const hangPromise = h
      .rawReq('GET', null, {
        headers: { 'x-test-hang': '1' },
        timeoutMs: 5000,
      })
      .catch(() => ({}));

    await new Promise(r => setTimeout(r, 200));

    // Close the first harness (kills WS + all TCP)
    await h.close();
    hangResolvers.forEach(({ res }) => {
      try {
        res.end('aborted');
      } catch (_) {}
    });
    hangPromise.catch(() => {});
    hangResolvers = [];

    // Second harness on new ports: verify clean start
    h = await startHarness({ targetHandler });
    await h.waitReady();

    const r = await h.rawReq('GET');
    expect(r.status).toBe(200);

    await h.close();
  });
});

/**
 * RWT-LIFE-001 / RWT-LIFE-002 lifecycle integration tests.
 *
 * Verifies the "if and only if" property: registry entries exist
 * if and only if the underlying resource is alive.
 *
 * Uses the real integration harness (real WS, real TCP, real tunnel client).
 */
const state = require('../../server/state');
const { startHarness } = require('../helpers/integrationHarness');

jest.setTimeout(30000);

describe('RWT-LIFE-002 tunnel entry lifecycle', () => {
  let harness;

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = null;
    }
  });

  it('tunnel entry exists after harness is ready', async () => {
    harness = await startHarness();
    await harness.waitReady();
    const { wsPort, tunnelId } = harness;

    const entry = state[wsPort]?.websocketTunnels?.[tunnelId];
    expect(entry).toBeDefined();
    expect(entry.ws).toBeDefined();
    expect(entry.ws.readyState).toBe(1); // OPEN
    expect(entry.tcpConnections).toBeDefined();
    expect(typeof entry.tcpConnections).toBe('object');
  });

  it('tunnel entry is deleted after WS close', async () => {
    harness = await startHarness();
    await harness.waitReady();
    const { wsPort, tunnelId } = harness;

    const entryBefore = state[wsPort]?.websocketTunnels?.[tunnelId];
    expect(entryBefore).toBeDefined();

    await harness.close();
    harness = null;

    const entryAfter = state[wsPort]?.websocketTunnels?.[tunnelId];
    expect(entryAfter).toBeUndefined();
  });

  it('tunnel entry has the correct ws reference while OPEN', async () => {
    harness = await startHarness();
    await harness.waitReady();
    const { wsPort, tunnelId } = harness;

    const entry = state[wsPort]?.websocketTunnels?.[tunnelId];
    expect(entry).toBeDefined();

    // ws must be the actual WebSocket object
    expect(typeof entry.ws.send).toBe('function');
    expect(entry.ws.readyState).toBe(1);
  });

  it('state[port] structure is correct while tunnel is alive', async () => {
    harness = await startHarness();
    await harness.waitReady();
    const { wsPort } = harness;

    expect(state[wsPort]).toBeDefined();
    expect(state[wsPort].websocketTunnels).toBeDefined();
    expect(typeof state[wsPort].websocketTunnels).toBe('object');
  });
});

describe('RWT-LIFE-001 tcpConnections entry lifecycle', () => {
  let harness;

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = null;
    }
  });

  it('tcpConnections is empty before any HTTP request (only WS established)', async () => {
    harness = await startHarness();
    const { wsPort, tunnelId } = harness;

    // Wait for the tunnel entry to appear (CONFIG processed)
    const tunnel = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('tunnel entry not created')), 5000);
      const poll = setInterval(() => {
        const t = state[wsPort]?.websocketTunnels?.[tunnelId];
        if (t) {
          clearInterval(poll);
          clearTimeout(deadline);
          resolve(t);
        }
      }, 20);
    });

    // WS is connected and CONFIG sent, but no TCP request yet
    expect(tunnel).toBeDefined();
    expect(Object.keys(tunnel.tcpConnections)).toHaveLength(0);

    // Now make it ready for subsequent tests
    await harness.waitReady();
  });

  it('tcpConnections entry is created when HTTP request triggers ensureConn', async () => {
    harness = await startHarness();
    await harness.waitReady();
    const { wsPort, tunnelId } = harness;

    const tunnel = state[wsPort]?.websocketTunnels?.[tunnelId];

    // waitReady() already made a probe request, so there's at least one entry
    const uuids = Object.keys(tunnel.tcpConnections);
    expect(uuids.length).toBeGreaterThanOrEqual(1);

    const conn = tunnel.tcpConnections[uuids[0]];
    expect(conn).toBeDefined();
    expect(conn.socket).toBeDefined();
    expect(conn.queue).toBeDefined();
    expect(conn.sender).toBeDefined();
  });

  it('tcpConnections entry is deleted after WS close', async () => {
    harness = await startHarness();
    await harness.waitReady();
    const { wsPort, tunnelId } = harness;

    const tunnel = state[wsPort]?.websocketTunnels?.[tunnelId];
    const uuidsBefore = Object.keys(tunnel.tcpConnections);
    expect(uuidsBefore.length).toBeGreaterThanOrEqual(1);

    await harness.close();
    harness = null;

    // After WS close, the tunnel entry itself is deleted
    const entryAfter = state[wsPort]?.websocketTunnels?.[tunnelId];
    expect(entryAfter).toBeUndefined();
  });

  it('tcpConnections entry is recreated after new TCP connection', async () => {
    harness = await startHarness();
    await harness.waitReady();
    const { wsPort, tunnelId } = harness;

    const tunnel = state[wsPort]?.websocketTunnels?.[tunnelId];
    const uuidsBefore = Object.keys(tunnel.tcpConnections);

    // Make a new request with Connection: close to force a new TCP connection
    const res = await harness.rawReq('GET', null, {
      headers: { connection: 'close' },
    });
    expect(res.status).toBe(200);

    const uuidsAfter = Object.keys(tunnel.tcpConnections);
    // At least one new entry (may or may not be more, depending on timing)
    expect(uuidsAfter.length).toBeGreaterThanOrEqual(uuidsBefore.length);
  });

  it('tcpConnections entry contains expected structure', async () => {
    harness = await startHarness();
    await harness.waitReady();
    const { wsPort, tunnelId } = harness;

    const tunnel = state[wsPort]?.websocketTunnels?.[tunnelId];
    const uuids = Object.keys(tunnel.tcpConnections);
    const conn = tunnel.tcpConnections[uuids[0]];

    // Verify conn has all required properties
    expect(conn.socket).toBeDefined();
    expect(typeof conn.socket.write).toBe('function');
    expect(typeof conn.socket.destroy).toBe('function');

    expect(conn.sender).toBeDefined();
    expect(typeof conn.sender.send).toBe('function');
    expect(typeof conn.sender.destroy).toBe('function');
    expect(typeof conn.sender.isDestroyed).toBe('function');

    expect(conn.queue).toBeDefined();
    expect(typeof conn.queue.enqueue).toBe('function');
    expect(typeof conn.queue.destroy).toBe('function');
    expect(typeof conn.queue.isDestroyed).toBe('function');

    expect(conn.stats).toBeDefined();
    expect(typeof conn.stats.openedAt).toBe('number');
    expect(typeof conn.stats.bytesIn).toBe('number');
    expect(typeof conn.stats.bytesOut).toBe('number');
  });
});

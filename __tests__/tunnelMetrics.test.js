const { TunnelMetrics, getMetrics, resetMetrics } = require('../utils/tunnelMetrics');

describe('tunnelMetrics', () => {
  let metrics;
  beforeEach(() => {
    metrics = resetMetrics();
  });
  afterAll(() => {
    getMetrics().dispose();
  });

  it('counts tunnels and streams with proper cleanup', () => {
    metrics.registerTunnel('t1');
    metrics.registerStream('t1', 'u1');
    metrics.registerStream('t1', 'u2');
    metrics.registerTunnel('t2');

    expect(metrics.snapshot().active_tunnels).toBe(2);
    expect(metrics.snapshot().active_streams).toBe(2);

    // Unregistering a tunnel drops its streams too
    metrics.unregisterTunnel('t1');
    const snap = metrics.snapshot();
    expect(snap.active_tunnels).toBe(1);
    expect(snap.active_streams).toBe(0);
  });

  it('stores connectedAt and remoteAddress per tunnel', () => {
    const before = Date.now();
    metrics.registerTunnel('ta', { remoteAddress: '10.0.0.1' });
    const after = Date.now();

    const snap = metrics.snapshot();
    expect(snap.active_tunnel_ids).toEqual(['ta']);
    expect(snap.tunnels_detail.ta.remoteAddress).toBe('10.0.0.1');
    expect(snap.tunnels_detail.ta.connectedAt).toBeGreaterThanOrEqual(before);
    expect(snap.tunnels_detail.ta.connectedAt).toBeLessThanOrEqual(after);
    expect(snap.tunnels_detail.ta.streamCount).toBe(0);
    expect(snap.tunnels_detail.ta.bytesIn).toBe(0);
    expect(snap.tunnels_detail.ta.bytesOut).toBe(0);
    expect(snap.tunnels_detail.ta.agentVersion).toBe('unknown');
  });

  it('setTunnelMeta updates agentVersion', () => {
    metrics.registerTunnel('tm');
    expect(metrics.snapshot().tunnels_detail.tm.agentVersion).toBe('unknown');

    metrics.setTunnelMeta('tm', { agentVersion: '1.1.0' });
    expect(metrics.snapshot().tunnels_detail.tm.agentVersion).toBe('1.1.0');

    // No-op for non-existent tunnel
    metrics.setTunnelMeta('nonexistent', { agentVersion: '2.0.0' });
  });

  it('registerStream increments streamCount, unregisterStream decrements', () => {
    metrics.registerTunnel('ts');
    metrics.registerStream('ts', 'u1');
    metrics.registerStream('ts', 'u2');
    expect(metrics.snapshot().tunnels_detail.ts.streamCount).toBe(2);

    metrics.unregisterStream('ts', 'u1');
    expect(metrics.snapshot().tunnels_detail.ts.streamCount).toBe(1);

    metrics.unregisterStream('ts', 'u2');
    expect(metrics.snapshot().tunnels_detail.ts.streamCount).toBe(0);
  });

  it('peakStreamCount tracks maximum concurrent streams', () => {
    metrics.registerTunnel('pk');
    expect(metrics.snapshot().tunnels_detail.pk.peakStreamCount).toBe(0);

    metrics.registerStream('pk', 'u1');
    metrics.registerStream('pk', 'u2');
    metrics.registerStream('pk', 'u3');
    expect(metrics.snapshot().tunnels_detail.pk.peakStreamCount).toBe(3);

    // Unregister one — peak stays at 3
    metrics.unregisterStream('pk', 'u1');
    expect(metrics.snapshot().tunnels_detail.pk.streamCount).toBe(2);
    expect(metrics.snapshot().tunnels_detail.pk.peakStreamCount).toBe(3);

    // Register two more — peak grows to 4
    metrics.registerStream('pk', 'u4');
    metrics.registerStream('pk', 'u5');
    expect(metrics.snapshot().tunnels_detail.pk.peakStreamCount).toBe(4);
  });

  it('addTraffic with tunnelId updates per-tunnel bytes', () => {
    metrics.registerTunnel('tt');
    metrics.addTraffic(100, 200, 'tt');
    metrics.addTraffic(50, 0, 'tt');

    const detail = metrics.snapshot().tunnels_detail.tt;
    expect(detail.bytesIn).toBe(150);
    expect(detail.bytesOut).toBe(200);

    // Global counters still accumulate
    const snap = metrics.snapshot();
    expect(snap.bytes_in_total).toBe(150);
    expect(snap.bytes_out_total).toBe(200);
  });

  it('unregisterTunnel fully cleans up Map entry', () => {
    metrics.registerTunnel('td', { remoteAddress: '127.0.0.1' });
    metrics.registerStream('td', 'u1');
    metrics.addTraffic(10, 20, 'td');
    expect(metrics.snapshot().active_tunnels).toBe(1);

    metrics.unregisterTunnel('td');
    const snap = metrics.snapshot();
    expect(snap.active_tunnels).toBe(0);
    expect(snap.active_tunnel_ids).toEqual([]);
    expect(snap.tunnels_detail).toEqual({});
    expect(snap.active_streams).toBe(0);
  });

  it('reset clears the tunnels Map', () => {
    metrics.registerTunnel('r1');
    metrics.registerTunnel('r2');
    metrics.addTraffic(10, 20, 'r1');
    metrics.reset();

    const snap = metrics.snapshot();
    expect(snap.active_tunnels).toBe(0);
    expect(snap.active_tunnel_ids).toEqual([]);
    expect(snap.tunnels_detail).toEqual({});
    expect(snap.bytes_in_total).toBe(0);
  });

  it('tracks buffered bytes total and per tunnel, deleting zero entries', () => {
    metrics.setBuffered('u1:ws', 't1', 1000);
    metrics.setBuffered('u1:tcp', 't1', 500);
    metrics.setBuffered('u2:ws', 't2', 250);

    expect(metrics.getBufferedPerTunnel().total).toBe(1750);
    expect(metrics.getBufferedPerTunnel().perTunnel).toEqual({ t1: 1500, t2: 250 });
    expect(Object.keys(metrics.getBufferedPerStream())).toHaveLength(3);

    metrics.setBuffered('u1:ws', 't1', 0); // absolute update to zero
    expect(metrics.getBuffered('u1:ws')).toBe(0);
    expect(Object.keys(metrics.getBufferedPerStream())).toHaveLength(2);

    metrics.setBuffered('u1:tcp', 't1', 0);
    metrics.setBuffered('u2:ws', 't2', 0);
    expect(metrics.getBufferedPerTunnel().total).toBe(0);
  });

  it('unregisterTunnel clears leftover buffered accounting for that tunnel', () => {
    metrics.registerTunnel('t9');
    metrics.setBuffered('uX:tcp', 't9', 12345);
    metrics.unregisterTunnel('t9');
    expect(metrics.getBufferedPerTunnel().total).toBe(0);
  });

  it('accumulates counters and traffic', () => {
    metrics.addTraffic(10, 20);
    metrics.addTraffic(5);
    metrics.countBackpressure();
    metrics.countBackpressure();
    metrics.countFrameTooLarge();
    metrics.countDisconnect();
    metrics.countHeartbeatTimeout();

    const snap = metrics.snapshot();
    expect(snap.bytes_in_total).toBe(15);
    expect(snap.bytes_out_total).toBe(20);
    expect(snap.backpressure_events_total).toBe(2);
    expect(snap.frame_too_large_total).toBe(1);
    expect(snap.tunnel_disconnect_total).toBe(1);
    expect(snap.heartbeat_timeout_total).toBe(1);
  });

  it('exposes event loop lag percentiles in ms', async () => {
    // Spin the loop briefly so the histogram has samples
    await new Promise(r => setTimeout(r, 60));
    const { event_loop_lag_ms } = metrics.snapshot();
    expect(event_loop_lag_ms.p50).toBeGreaterThanOrEqual(0);
    expect(event_loop_lag_ms.p99).toBeGreaterThanOrEqual(0);
  });

  it('summary timer logs and can be stopped (no open handles)', () => {
    jest.useFakeTimers();
    const { logger } = require('../utils/logger');
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});

    metrics.startSummaryTimer(1000);
    jest.advanceTimersByTime(3500);
    expect(debugSpy).toHaveBeenCalledTimes(3);

    metrics.stopSummaryTimer();
    jest.advanceTimersByTime(10000);
    expect(debugSpy).toHaveBeenCalledTimes(3); // no more ticks

    debugSpy.mockRestore();
    jest.useRealTimers();
  });
});

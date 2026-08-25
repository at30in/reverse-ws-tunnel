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

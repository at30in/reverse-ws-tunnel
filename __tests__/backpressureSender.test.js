const { createBackpressureSender, applyWsBufferGuard } = require('../utils/backpressureSender');
const { getTunnelLimits } = require('../utils/tunnelLimits');
const { TunnelMetrics } = require('../utils/tunnelMetrics');

const M = 1024 * 1024;
const CHUNK = Buffer.alloc(64 * 1024); // 64KB payload
const WIRE_OVERHEAD = 77; // 4B length prefix + 73B message header

/**
 * Minimal ws stub: records sends, exposes bufferedAmount and lets tests
 * flush completion callbacks to simulate socket progress.
 */
function makeFakeWs() {
  const pendingCallbacks = [];
  return {
    readyState: 1, // WebSocket.OPEN
    maxBufferedAmount: undefined,
    sentMessages: [],
    bufferedAmount: 0,
    send(msg, cb) {
      this.sentMessages.push(msg);
      this.bufferedAmount += msg.length;
      pendingCallbacks.push(() => {
        this.bufferedAmount -= msg.length;
        cb();
      });
    },
    /** Completes up to n queued sends (oldest first), default all. */
    flush(n = Infinity) {
      for (let i = 0; i < n && pendingCallbacks.length > 0; i++) {
        pendingCallbacks.shift()();
      }
    },
    pendingCount: () => pendingCallbacks.length,
  };
}

function makeSender(ws, overrides = {}) {
  const metrics = overrides.metrics ?? new TunnelMetrics();
  const events = [];
  const sender = createBackpressureSender({
    ws,
    tunnelId: 't'.repeat(36),
    uuid: 'u'.repeat(36),
    limits: getTunnelLimits(),
    metrics,
    onPause: () => events.push('pause'),
    onResume: () => events.push('resume'),
    ...overrides,
  });
  return { sender, metrics, events };
}

describe('backpressureSender', () => {
  it('sends framed messages and tracks outstanding bytes', () => {
    const ws = makeFakeWs();
    const { sender } = makeSender(ws);

    expect(sender.send(CHUNK)).toBe(CHUNK.length + WIRE_OVERHEAD);
    expect(sender.getOutstanding()).toBe(CHUNK.length + WIRE_OVERHEAD);
    expect(sender.isPaused()).toBe(false);
    expect(ws.sentMessages).toHaveLength(1);
  });

  it('pauses above HIGH and resumes below LOW with hysteresis', () => {
    const ws = makeFakeWs();
    const { sender, events } = makeSender(ws);

    let sends = 0;
    while (!sender.isPaused()) {
      sender.send(CHUNK);
      sends++;
    }
    expect(sends).toBe(Math.ceil((8 * M) / (CHUNK.length + WIRE_OVERHEAD)));
    expect(events).toEqual(['pause']);

    // Partial drain: still between LOW and HIGH -> stays paused, no events
    ws.flush(60);
    expect(sender.isPaused()).toBe(true);
    expect(events).toEqual(['pause']);

    // Full drain below LOW: exactly one resume
    ws.flush();
    expect(sender.isPaused()).toBe(false);
    expect(events).toEqual(['pause', 'resume']);
    expect(sender.getOutstanding()).toBe(0);
  });

  it('reports absolute buffered accounting per stream key', () => {
    const ws = makeFakeWs();
    const metrics = new TunnelMetrics();
    const { sender } = makeSender(ws, { metrics });

    sender.send(CHUNK);
    expect(metrics.getBuffered(sender.bufferKey)).toBe(CHUNK.length + WIRE_OVERHEAD);

    ws.flush();
    expect(metrics.getBuffered(sender.bufferKey)).toBe(0);
  });

  it('counts payload bytes as outbound traffic', () => {
    const ws = makeFakeWs();
    const metrics = new TunnelMetrics();
    const { sender } = makeSender(ws, { metrics });

    sender.send(CHUNK);
    expect(metrics.snapshot().bytes_out_total).toBe(CHUNK.length);
  });

  it('decrements outstanding even when the send callback reports an error', () => {
    const errors = [];
    const failingWs = makeFakeWs();
    failingWs.send = function (_msg, cb) {
      cb(new Error('socket gone'));
    };
    const { sender } = makeSender(failingWs, { onSendError: err => errors.push(err) });

    sender.send(CHUNK);
    expect(sender.getOutstanding()).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('socket gone');
  });

  it('refuses to send when ws is not OPEN or destroyed', () => {
    const closedWs = makeFakeWs();
    closedWs.readyState = 3; // CLOSED
    const { sender } = makeSender(closedWs);
    expect(sender.send(CHUNK)).toBeNull();

    const ws = makeFakeWs();
    const { sender: s2 } = makeSender(ws);
    s2.destroy();
    expect(s2.send(CHUNK)).toBeNull();
  });

  it('reconcile force-resumes when callbacks were lost and ws buffer is empty', () => {
    const ws = makeFakeWs();
    const { sender, events } = makeSender(ws, { staleMs: 0 }); // instantly stale

    while (!sender.isPaused()) sender.send(CHUNK);
    expect(sender.isPaused()).toBe(true);

    // Ground truth says nothing is pending anymore (callbacks lost)
    ws.bufferedAmount = 0;

    expect(sender.reconcile()).toBe(true);
    expect(sender.getOutstanding()).toBe(0);
    expect(sender.isPaused()).toBe(false);
    expect(events).toEqual(['pause', 'resume']);
  });

  it('reconcile resyncs accounting from bufferedAmount when below LOW', () => {
    const ws = makeFakeWs();
    const { sender, events } = makeSender(ws);

    while (!sender.isPaused()) sender.send(CHUNK);

    // Everything flushed except ~1KB residue still queued in ws
    ws.bufferedAmount = 1024;

    expect(sender.reconcile()).toBe(true);
    expect(sender.getOutstanding()).toBe(1024);
    expect(sender.isPaused()).toBe(false);
    expect(events).toContain('resume');
  });

  it('reconcile is a no-op when not paused', () => {
    const ws = makeFakeWs();
    const { sender } = makeSender(ws, { staleMs: 0 });
    sender.send(CHUNK);
    expect(sender.reconcile()).toBe(false);
  });

  it('destroy clears state and metric entry without firing resume', () => {
    const ws = makeFakeWs();
    const metrics = new TunnelMetrics();
    const { sender, events } = makeSender(ws, { metrics });

    while (!sender.isPaused()) sender.send(CHUNK);
    sender.destroy();

    expect(sender.isDestroyed()).toBe(true);
    expect(sender.isPaused()).toBe(false);
    expect(sender.getOutstanding()).toBe(0);
    expect(metrics.getBuffered(sender.bufferKey)).toBe(0);
    expect(events).toEqual(['pause']);
  });

  it('applyWsBufferGuard is a no-op (our sender handles flow control)', () => {
    const ws = makeFakeWs();
    applyWsBufferGuard(ws, getTunnelLimits());
    // The guard is intentionally a no-op: our sender's pause/resume
    // mechanism is the primary flow-control.  ws.maxBufferedAmount is
    // NOT set because the ws library destroys the socket when it is
    // exceeded, which is too aggressive for legitimate large transfers.
    expect(ws.maxBufferedAmount).toBeUndefined();

    // Must not throw even when the ws object rejects property sets.
    const stubborn = {};
    Object.defineProperty(stubborn, 'maxBufferedAmount', {
      set() {
        throw new TypeError('unsupported');
      },
    });
    expect(() => applyWsBufferGuard(stubborn, getTunnelLimits())).not.toThrow();
  });
});

describe('RWT-KNOWN-004 destroy idempotency', () => {
  it('double destroy does not throw and state remains destroyed', () => {
    const ws = makeFakeWs();
    const { sender } = makeSender(ws);

    sender.destroy();
    expect(sender.isDestroyed()).toBe(true);

    // Second destroy must not throw
    expect(() => sender.destroy()).not.toThrow();
    expect(sender.isDestroyed()).toBe(true);
    expect(sender.getOutstanding()).toBe(0);
  });

  it('triple destroy does not throw and metrics stay clean', () => {
    const ws = makeFakeWs();
    const metrics = new TunnelMetrics();
    const { sender } = makeSender(ws, { metrics });

    sender.send(CHUNK);
    sender.destroy();
    sender.destroy();
    sender.destroy();

    expect(sender.isDestroyed()).toBe(true);
    expect(sender.getOutstanding()).toBe(0);
    expect(metrics.getBuffered(sender.bufferKey)).toBe(0);
  });

  it('send() returns null after destroy', () => {
    const ws = makeFakeWs();
    const { sender } = makeSender(ws);

    sender.destroy();
    expect(sender.send(CHUNK)).toBeNull();
    expect(sender.getOutstanding()).toBe(0);
  });

  it('send() returns null after double destroy', () => {
    const ws = makeFakeWs();
    const { sender } = makeSender(ws);

    sender.destroy();
    sender.destroy();
    expect(sender.send(CHUNK)).toBeNull();
  });

  it('pending ws.send callback after destroy does not resurrect sender', () => {
    const ws = makeFakeWs();
    const { sender } = makeSender(ws);

    // Send a message — ws.send callback is pending
    sender.send(CHUNK);
    expect(sender.getOutstanding()).toBe(CHUNK.length + WIRE_OVERHEAD);

    // Destroy before callback fires
    sender.destroy();
    expect(sender.getOutstanding()).toBe(0);

    // Flush the pending callback — it should not resurrect outstanding
    ws.flush();
    // outstanding should remain 0 (callback decrements but clamps at 0)
    expect(sender.getOutstanding()).toBe(0);
    expect(sender.isDestroyed()).toBe(true);
  });

  it('send() is a no-op after destroy even with OPEN ws', () => {
    const ws = makeFakeWs();
    ws.readyState = 1; // OPEN
    const { sender } = makeSender(ws);

    sender.destroy();
    const result = sender.send(CHUNK);
    expect(result).toBeNull();
    // ws.send should not have been called
    expect(ws.sentMessages).toHaveLength(0);
  });

  it('reconcile() returns false after destroy', () => {
    const ws = makeFakeWs();
    const { sender } = makeSender(ws, { staleMs: 0 });

    while (!sender.isPaused()) sender.send(CHUNK);
    sender.destroy();

    expect(sender.reconcile()).toBe(false);
  });

  it('destroy during paused state does not fire onResume', () => {
    const ws = makeFakeWs();
    const { sender, events } = makeSender(ws);

    while (!sender.isPaused()) sender.send(CHUNK);
    expect(sender.isPaused()).toBe(true);
    expect(events).toEqual(['pause']);

    sender.destroy();
    // onResume must NOT have been called
    expect(events).toEqual(['pause']);
    expect(sender.isPaused()).toBe(false);
    expect(sender.isDestroyed()).toBe(true);
  });

  it('destroy() on never-used sender is safe', () => {
    const ws = makeFakeWs();
    const { sender } = makeSender(ws);

    expect(sender.isDestroyed()).toBe(false);
    sender.destroy();
    expect(sender.isDestroyed()).toBe(true);
    expect(sender.getOutstanding()).toBe(0);
    expect(sender.send(CHUNK)).toBeNull();
  });
});

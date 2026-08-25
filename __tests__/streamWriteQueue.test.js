const { EventEmitter } = require('events');
const { createStreamWriteQueue } = require('../utils/streamWriteQueue');
const { getTunnelLimits } = require('../utils/tunnelLimits');
const { TunnelMetrics } = require('../utils/tunnelMetrics');

const M = 1024 * 1024;
const TUNNEL = 't'.repeat(36);
const UUID = 'u'.repeat(36);

/**
 * net.Socket stub: controllable write() return values, records exact
 * write order, simulates kernel-side pending bytes until 'drain'.
 */
function makeFakeSocket() {
  const sock = new EventEmitter();
  sock.written = [];
  sock.writeResults = []; // queued booleans; defaultWriteResult when empty
  sock.defaultWriteResult = true;
  sock.writableLength = 0;
  sock.destroyed = false;

  sock.write = jest.fn(payload => {
    sock.written.push(payload);
    const result =
      sock.writeResults.length > 0 ? sock.writeResults.shift() : sock.defaultWriteResult;
    if (!result) sock.writableLength += payload.length;
    return result;
  });

  sock.emitDrain = () => {
    sock.writableLength = 0;
    sock.emit('drain');
  };

  sock.end = jest.fn();
  sock.destroy = jest.fn(() => {
    sock.destroyed = true;
    sock.emit('close');
  });
  return sock;
}

function makeQueue(socket, overrides = {}) {
  const metrics = overrides.metrics ?? new TunnelMetrics();
  const overflows = [];
  const queue = createStreamWriteQueue({
    socket,
    tunnelId: TUNNEL,
    uuid: UUID,
    limits: getTunnelLimits(),
    metrics,
    onOverflow: scope => overflows.push(scope),
    ...overrides,
  });
  return { queue, metrics, overflows };
}

describe('streamWriteQueue', () => {
  it('writes immediately in order when there is no backpressure', () => {
    const socket = makeFakeSocket();
    const { queue, metrics } = makeQueue(socket);

    expect(queue.enqueue(Buffer.from('a'))).toBe(true);
    expect(queue.enqueue(Buffer.from('b'))).toBe(true);

    expect(socket.written.map(String)).toEqual(['a', 'b']);
    expect(queue.depth()).toBe(0);
    expect(queue.queuedBytes()).toBe(0);
    expect(metrics.getBuffered(queue.bufferKey)).toBe(0);
  });

  it('buffers and preserves order across a false -> drain cycle', () => {
    const socket = makeFakeSocket();
    socket.writeResults = [true, false]; // second write saturates
    const { queue, metrics } = makeQueue(socket);

    queue.enqueue(Buffer.from('1')); // direct, ok
    queue.enqueue(Buffer.from('2')); // direct, backpressure starts
    queue.enqueue(Buffer.from('3')); // queued
    queue.enqueue(Buffer.from('4')); // queued

    expect(socket.written.map(String)).toEqual(['1', '2']);
    expect(queue.depth()).toBe(2);
    expect(metrics.getBuffered(queue.bufferKey)).toBeGreaterThan(0); // pending in kernel+queue

    socket.emitDrain();
    expect(socket.written.map(String)).toEqual(['1', '2', '3', '4']);
    expect(queue.depth()).toBe(0);
    expect(metrics.getBuffered(queue.bufferKey)).toBe(0);
  });

  it('stops pumping again when drain re-saturates mid-flush', () => {
    const socket = makeFakeSocket();
    socket.writeResults = [false];
    const { queue } = makeQueue(socket);

    queue.enqueue(Buffer.from('a'));
    queue.enqueue(Buffer.from('b'));
    queue.enqueue(Buffer.from('c'));
    expect(socket.written.map(String)).toEqual(['a']);

    socket.writeResults = [false]; // drain flush hits backpressure again
    socket.emitDrain();
    expect(socket.written.map(String)).toEqual(['a', 'b']);
    expect(queue.depth()).toBe(1);

    socket.emitDrain();
    expect(socket.written.map(String)).toEqual(['a', 'b', 'c']);
  });

  it('overflows at MAX_BUFFER_PER_STREAM and closes the stream exactly once', () => {
    const socket = makeFakeSocket();
    socket.defaultWriteResult = false; // everything backs up
    const TINY_LIMITS = getTunnelLimits({ maxBufferPerStreamBytes: 8 * M });
    const { queue, overflows } = makeQueue(socket, { limits: TINY_LIMITS });

    const chunk5MB = Buffer.alloc(5 * M);
    expect(queue.enqueue(chunk5MB)).toBe(true); // pumped into the kernel socket
    expect(queue.enqueue(chunk5MB)).toBe(true); // 5MB held in our queue
    expect(queue.enqueue(chunk5MB)).toBe(false); // would make it 10MB > 8MB

    expect(overflows).toEqual(['stream']); // exactly one overflow event
    expect(queue.isDestroyed()).toBe(true);
  });

  it('overflows at MAX_BUFFER_PER_TUNNEL via shared accounting', () => {
    const socket = makeFakeSocket();
    socket.defaultWriteResult = false;
    const metrics = new TunnelMetrics();
    const TINY_LIMITS = getTunnelLimits({
      maxBufferPerStreamBytes: 8 * M,
      maxBufferPerTunnelBytes: 32 * M,
    });

    const { queue: other } = makeQueue(makeFakeSocket(), { metrics, limits: TINY_LIMITS }); // sibling stream, same tunnel
    other._testNoop = true;

    const { queue, overflows } = makeQueue(socket, { metrics, limits: TINY_LIMITS });

    // Fill this stream to just under its own cap (7MB of 8MB)
    const chunk1MB = Buffer.alloc(M);
    for (let i = 0; i < 7; i++) {
      expect(queue.enqueue(chunk1MB)).toBe(true);
    }

    // Sibling stream reports 26MB buffered for the same tunnel ->
    // 7MB (ours) + 26MB = 33MB > 32MB tunnel cap on next enqueue
    metrics.setBuffered('sibling:tcp', TUNNEL, 26 * M);
    expect(queue.enqueue(chunk1MB)).toBe(false);
    expect(overflows).toEqual(['tunnel']);
  });

  it('warns but accepts when the process-wide cap is exceeded', () => {
    const socket = makeFakeSocket();
    const metrics = new TunnelMetrics();
    metrics.setBuffered('elsewhere:ws', 'other-tunnel', 512 * M - 1000);
    const warnSpy = jest
      .spyOn(require('../utils/logger').logger, 'warn')
      .mockImplementation(() => {});

    const { queue, overflows } = makeQueue(socket, { metrics });
    expect(queue.enqueue(Buffer.alloc(2000))).toBe(true); // crosses process cap
    expect(overflows).toEqual([]); // process level is log-only
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('scope=process'));

    warnSpy.mockRestore();
  });

  it('cleans up listeners and accounting on destroy()', () => {
    const socket = makeFakeSocket();
    socket.defaultWriteResult = false;
    const metrics = new TunnelMetrics();
    const { queue } = makeQueue(socket, { metrics });

    queue.enqueue(Buffer.from('x'));
    queue.destroy();

    expect(queue.isDestroyed()).toBe(true);
    expect(socket.listenerCount('drain')).toBe(0);
    expect(metrics.getBuffered(queue.bufferKey)).toBe(0);
    expect(queue.enqueue(Buffer.from('y'))).toBe(false);
  });

  it('self-destroys when the underlying socket closes or errors', () => {
    const closeSocket = makeFakeSocket();
    const q1 = makeQueue(closeSocket).queue;
    closeSocket.destroy(); // emits 'close'
    expect(q1.isDestroyed()).toBe(true);

    const errSocket = makeFakeSocket();
    const q2 = makeQueue(errSocket).queue;
    errSocket.emit('error', new Error('boom'));
    expect(q2.isDestroyed()).toBe(true);
  });

  it('rejects non-net.Socket instances', () => {
    expect(() =>
      createStreamWriteQueue({
        socket: new EventEmitter(),
        tunnelId: TUNNEL,
        uuid: UUID,
        limits: getTunnelLimits(),
      })
    ).toThrow(TypeError);
  });
});

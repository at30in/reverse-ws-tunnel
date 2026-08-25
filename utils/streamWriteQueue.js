/**
 * Bounded FIFO write queue between the WebSocket and one local TCP
 * socket (one stream / uuid).
 *
 * Why a queue at all: the WebSocket pushes frames as they arrive; if the
 * local TCP consumer is slower, `socket.write()` alone would let Node's
 * internal socket buffer grow without bound (highWaterMark only affects
 * the boolean return, not the actual buffering).
 *
 * Design:
 *  - Every chunk flows through this single path -> strict ordering.
 *  - Pumping stops as soon as `write()` reports backpressure and resumes
 *    on the socket 'drain' event, keeping the kernel-side buffer small.
 *  - Our own pending bytes are capped by MAX_BUFFER_PER_STREAM; the
 *    tunnel-wide cap is enforced through the shared metrics registry.
 *  - On overflow the queue calls `onOverflow(scope)` ONCE and shuts down:
 *    the owner closes the stream in a controlled way (CLOSE + socket
 *    teardown). A single misbehaving stream never kills the tunnel.
 */

const { logger } = require('./logger');

function createStreamWriteQueue({ socket, tunnelId, uuid, limits, metrics, onOverflow }) {
  if (!socket || typeof socket.write !== 'function' || typeof socket.once !== 'function') {
    throw new TypeError('socket must be a writable stream-like object');
  }

  const queue = [];
  let queuedBytes = 0;
  let drained = true;
  let destroyed = false;
  const bufferKey = `${uuid}:tcp`;

  function updateAccounting() {
    // Kernel-side pending + our own queued bytes, reported absolutely.
    if (metrics) {
      metrics.setBuffered(bufferKey, tunnelId, socket.writableLength + queuedBytes);
    }
  }

  function removeDrainListener() {
    socket.removeListener('drain', onDrain);
  }

  function overflow(scope, incomingBytes) {
    logger.warn(
      `[buffer_limit_reached] scope=${scope} stream=${bufferKey} ` +
        `queued=${queuedBytes}B incoming=${incomingBytes}B ` +
        `limit=${scope === 'stream' ? limits.maxBufferPerStreamBytes : limits.maxBufferPerTunnelBytes}B — closing stream`
    );
    if (metrics) metrics.countBackpressure();
    destroy();
    if (onOverflow) onOverflow(scope);
    return false;
  }

  function pump() {
    while (queue.length > 0 && drained) {
      const payload = queue.shift();
      queuedBytes -= payload.length;
      drained = socket.write(payload);
      if (!drained) {
        socket.once('drain', onDrain);
        break;
      }
    }
    updateAccounting();
  }

  function onDrain() {
    drained = true;
    pump();
  }

  /** @returns {boolean} true if accepted, false if rejected/closed */
  function enqueue(payload) {
    if (destroyed) return false;
    if (metrics) metrics.addTraffic(payload.length, 0);

    if (queuedBytes + payload.length > limits.maxBufferPerStreamBytes) {
      return overflow('stream', payload.length);
    }
    if (metrics) {
      const { total, perTunnel } = metrics.getBufferedPerTunnel();
      const tunnelBuffered = perTunnel[tunnelId] || 0;
      if (tunnelBuffered + payload.length > limits.maxBufferPerTunnelBytes) {
        return overflow('tunnel', payload.length);
      }
      if (total + payload.length > limits.maxBufferPerProcessBytes) {
        logger.warn(
          `[buffer_limit_reached] scope=process buffered=${total}B incoming=${payload.length}B ` +
            `limit=${limits.maxBufferPerProcessBytes}B — enforcement relies on per-stream/per-tunnel caps`
        );
      }
    }

    queue.push(payload);
    queuedBytes += payload.length;
    if (drained) {
      pump();
    } else {
      updateAccounting();
    }
    return true;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    queue.length = 0;
    queuedBytes = 0;
    removeDrainListener();
    if (metrics) metrics.clearBuffered(bufferKey);
  }

  // If the socket dies underneath us, do not leak the queue or listeners.
  socket.once('close', destroy);
  socket.once('error', destroy);

  return {
    enqueue,
    destroy,
    isDestroyed: () => destroyed,
    queuedBytes: () => queuedBytes,
    depth: () => queue.length,
    bufferKey,
  };
}

module.exports = { createStreamWriteQueue };

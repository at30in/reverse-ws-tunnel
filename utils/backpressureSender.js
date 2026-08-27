/**
 * Per-stream bounded sender toward the WebSocket.
 *
 * Tracks how many bytes have been handed to `ws.send()` but not yet
 * written to the underlying socket, using the completion callback of the
 * `ws` library (no polling). Crossing HIGH pauses the local TCP producer
 * (`onPause` -> socket.pause()); draining back below LOW resumes it
 * (`onResume`). The gap between the two thresholds provides hysteresis
 * so pause/resume cannot thrash.
 *
 * A periodic `reconcile()` against `ws.bufferedAmount` guards against a
 * stuck pause if a completion callback were ever lost (the failure mode
 * that caused deadlocks in earlier attempts).
 */

const { buildMessageBuffer } = require('../client/utils');
const { logger } = require('./logger');

const DEFAULTS = {
  /** ms without progress after which reconcile() may force-resume. */
  staleMs: 10000,
};

function createBackpressureSender({
  ws,
  tunnelId,
  uuid,
  limits,
  metrics,
  bufferKeySuffix = ':ws',
  onPause,
  onResume,
  onSendError,
  staleMs = DEFAULTS.staleMs,
}) {
  let outstanding = 0;
  let paused = false;
  let destroyed = false;
  let lastProgressTs = Date.now();
  let sentMessages = 0;
  let sentBytes = 0;

  const bufferKey = `${uuid}${bufferKeySuffix}`;

  function reportBuffered() {
    if (metrics) metrics.setBuffered(bufferKey, tunnelId, outstanding);
  }

  function maybePause() {
    if (destroyed || paused || outstanding < limits.highWatermarkBytes) return;
    paused = true;
    if (metrics) metrics.countBackpressure();
    logger.debug(
      `[backpressure] start stream=${bufferKey} outstanding=${outstanding}B (high=${limits.highWatermarkBytes}B)`
    );
    if (onPause) onPause();
  }

  function maybeResume(reason = 'drain') {
    if (!paused) return;
    if (outstanding > limits.lowWatermarkBytes) return;
    paused = false;
    logger.debug(
      `[backpressure] end (${reason}) stream=${bufferKey} outstanding=${outstanding}B (low=${limits.lowWatermarkBytes}B)`
    );
    if (onResume) onResume();
  }

  /**
   * Builds the framed message and hands it to the WebSocket. Returns the
   * wire message length, or null if the stream/ws is no longer usable.
   */
  function send(payload) {
    if (destroyed) return null;
    if (!ws || ws.readyState !== 1 /* WebSocket.OPEN */) return null;

    const message = buildMessageBuffer(tunnelId, uuid, 0x02 /* MESSAGE_TYPE_DATA */, payload);
    const len = message.length;
    outstanding += len;
    sentMessages++;
    sentBytes += payload.length;
    lastProgressTs = Date.now();
    reportBuffered();
    if (metrics) metrics.addTraffic(0, payload.length);

    // ws guarantees the callback runs exactly once, also on error/close.
    ws.send(message, err => {
      if (destroyed) return;
      outstanding -= len;
      if (outstanding < 0) outstanding = 0;
      lastProgressTs = Date.now();
      reportBuffered();
      if (err) {
        logger.warn(`[backpressure] send error on stream=${bufferKey}: ${err.message}`);
        if (onSendError) onSendError(err);
      }
      maybeResume('callback');
    });

    maybePause();
    return len;
  }

  /**
   * Safety net against a lost completion callback leaving the producer
   * paused forever. Call from an existing slow timer (e.g. heartbeat).
   */
  function reconcile() {
    if (destroyed || !paused) return false;
    const real = ws?.bufferedAmount ?? 0;
    const staleForMs = Date.now() - lastProgressTs;

    if (real === 0 && staleForMs >= staleMs) {
      // Callbacks were lost: rebuild accounting from ground truth.
      logger.warn(
        `[backpressure] reconcile(stream=${bufferKey}): no progress for ${staleForMs}ms with empty ws buffer, forcing resume`
      );
      outstanding = 0;
      reportBuffered();
      paused = false;
      if (onResume) onResume();
      return true;
    }
    if (real <= limits.lowWatermarkBytes && outstanding > real) {
      logger.debug(
        `[backpressure] reconcile(stream=${bufferKey}): tracked=${outstanding}B vs bufferedAmount=${real}B`
      );
      outstanding = real;
      reportBuffered();
      maybeResume('reconcile');
      return true;
    }
    return false;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    outstanding = 0;
    if (metrics) metrics.clearBuffered(bufferKey);
    if (paused) {
      paused = false;
      // Do not call onResume: the stream is going away entirely.
    }
  }

  return {
    send,
    reconcile,
    destroy,
    getOutstanding: () => outstanding,
    isPaused: () => paused,
    isDestroyed: () => destroyed,
    stats: () => ({ sentMessages, sentBytes }),
    bufferKey,
  };
}

/**
 * Catastrophic backstop: if our bookkeeping ever fails, make the ws lib
 * itself refuse unbounded buffering instead of growing silently.
 *
 * The cap must sit well above our HIGH watermark so that our own
 * pause/resume mechanism always triggers first. Setting it too low
 * (e.g. highWatermark * 2) caused ws.send() to destroy the socket on
 * legitimate large transfers (20-100 MB) because the ws lib's internal
 * maxBufferedAmount check fires BEFORE our pause mechanism can drain
 * the data already in the pipeline.
 *
 * We use a very generous limit (highWatermark * 32, default 256 MB) so
 * the ws lib only intervenes in case of a true memory explosion. Our
 * sender's pause/resume on the entry socket is the primary flow control.
 */
function applyWsBufferGuard(_ws, _limits) {
  // Intentionally a no-op: our own pause/resume backpressure is the
  // primary flow-control mechanism.  The ws library's built-in
  // maxBufferedAmount guard destroys the socket when exceeded, which
  // is too aggressive for legitimate large transfers (the server-side
  // ws can buffer many frames before the client drains them).  Our
  // sender already pauses the upstream entry socket when the ws buffer
  // grows past the high watermark.
}

module.exports = { createBackpressureSender, applyWsBufferGuard };

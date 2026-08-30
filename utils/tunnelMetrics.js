/**
 * Lightweight in-process metrics registry for the tunnel.
 *
 * Deliberately dependency-free: plain counters plus a bounded per-buffer
 * accounting map, an event-loop-lag histogram and an optional periodic
 * structured summary log. No scraping endpoint, no heavy infra.
 */

const { monitorEventLoopDelay } = require('perf_hooks');
const { logger } = require('./logger');

/**
 * @typedef {Object} TunnelInfo
 * @property {number} connectedAt - Date.now() when the tunnel was registered
 * @property {string} remoteAddress - Client IP from the WS upgrade request
 * @property {number} streamCount - Number of active TCP streams
 * @property {number} peakStreamCount - Maximum concurrent TCP streams seen
 * @property {number} bytesIn - Total bytes received from the tunnel (WS → TCP)
 * @property {number} bytesOut - Total bytes sent to the tunnel (TCP → WS)
 * @property {string} agentVersion - Client library version from CONFIG message
 */

class TunnelMetrics {
  constructor({ label = 'tunnel' } = {}) {
    this.label = label;
    /** @type {Map<string, TunnelInfo>} */
    this.activeTunnels = new Map();
    this.activeStreams = new Set(); // `${tunnelId}/${uuid}`
    this.bytesInTotal = 0;
    this.bytesOutTotal = 0;
    this.backpressureEventsTotal = 0;
    this.frameTooLargeTotal = 0;
    this.tunnelDisconnectTotal = 0;
    this.heartbeatTimeoutTotal = 0;
    this.streamStallCleanupTotal = 0;

    // bufferKey -> { tunnelId, bytes }; entries removed at zero so the
    // map cannot grow unboundedly across short-lived streams.
    this._buffered = new Map();
    this._loopMonitor = monitorEventLoopDelay({ resolution: 20 });
    this._loopMonitor.enable();
    // Metrics must never keep the process alive on their own.
    this._loopMonitor.unref?.();
    this._summaryTimer = null;
  }

  registerTunnel(tunnelId, { remoteAddress = '' } = {}) {
    const id = String(tunnelId);
    this.activeTunnels.set(id, {
      connectedAt: Date.now(),
      remoteAddress,
      streamCount: 0,
      peakStreamCount: 0,
      bytesIn: 0,
      bytesOut: 0,
      agentVersion: 'unknown',
    });
  }

  unregisterTunnel(tunnelId) {
    const id = String(tunnelId);
    this.activeTunnels.delete(id);
    const prefix = `${id}/`;
    for (const key of [...this.activeStreams]) {
      if (key.startsWith(prefix)) this.activeStreams.delete(key);
    }
    this._dropBufferedForTunnel(id);
  }

  setTunnelMeta(tunnelId, { agentVersion } = {}) {
    const info = this.activeTunnels.get(String(tunnelId));
    if (!info) return;
    if (agentVersion !== undefined) info.agentVersion = agentVersion;
  }

  registerStream(tunnelId, uuid) {
    const id = String(tunnelId);
    this.activeStreams.add(`${id}/${String(uuid)}`);
    const info = this.activeTunnels.get(id);
    if (info) {
      info.streamCount++;
      if (info.streamCount > info.peakStreamCount) {
        info.peakStreamCount = info.streamCount;
      }
    }
  }

  unregisterStream(tunnelId, uuid) {
    const id = String(tunnelId);
    this.activeStreams.delete(`${id}/${String(uuid)}`);
    const info = this.activeTunnels.get(id);
    if (info && info.streamCount > 0) info.streamCount--;
  }

  _dropBufferedForTunnel(tunnelId) {
    const id = String(tunnelId);
    for (const [key, entry] of this._buffered) {
      if (entry.tunnelId === id) this._buffered.delete(key);
    }
  }

  /**
   * Reports the absolute number of bytes currently queued by a component
   * for a stream. `bufferKey` must be unique per component, e.g.
   * `<uuid>:ws` (sender toward the WebSocket) or `<uuid>:tcp` (queue
   * toward the local TCP socket).
   */
  setBuffered(bufferKey, tunnelId, bytes) {
    const prev = this._buffered.get(bufferKey);
    if (prev) {
      prev.bytes = bytes;
    } else if (bytes > 0) {
      this._buffered.set(bufferKey, { tunnelId: String(tunnelId), bytes });
    }
    if (prev && bytes === 0) this._buffered.delete(bufferKey);
  }

  clearBuffered(bufferKey) {
    this._buffered.delete(bufferKey);
  }

  getBuffered(bufferKey) {
    return this._buffered.get(bufferKey)?.bytes ?? 0;
  }

  getBufferedPerStream() {
    return Object.fromEntries([...this._buffered].map(([k, v]) => [k, v.bytes]));
  }

  getBufferedPerTunnel() {
    const perTunnel = {};
    let total = 0;
    for (const { tunnelId, bytes } of this._buffered.values()) {
      perTunnel[tunnelId] = (perTunnel[tunnelId] || 0) + bytes;
      total += bytes;
    }
    return { total, perTunnel };
  }

  addTraffic(bytesIn = 0, bytesOut = 0, tunnelId = null) {
    this.bytesInTotal += bytesIn;
    this.bytesOutTotal += bytesOut;
    if (tunnelId) {
      const info = this.activeTunnels.get(String(tunnelId));
      if (info) {
        info.bytesIn += bytesIn;
        info.bytesOut += bytesOut;
      }
    }
  }

  countBackpressure() {
    this.backpressureEventsTotal++;
  }

  countFrameTooLarge() {
    this.frameTooLargeTotal++;
  }

  countDisconnect() {
    this.tunnelDisconnectTotal++;
  }

  countHeartbeatTimeout() {
    this.heartbeatTimeoutTotal++;
  }

  countStreamStallCleanup() {
    this.streamStallCleanupTotal++;
  }

  _loopLagPercentiles() {
    const m = this._loopMonitor;
    if (!m || m.count === 0) return { p50: 0, p99: 0 };
    return {
      p50: Number(m.percentile(50) / 1e6), // ns -> ms
      p99: Number(m.percentile(99) / 1e6),
    };
  }

  snapshot() {
    const { total, perTunnel } = this.getBufferedPerTunnel();
    const active_tunnel_ids = [...this.activeTunnels.keys()];
    const tunnels_detail = Object.fromEntries(
      active_tunnel_ids.map(id => [id, { ...this.activeTunnels.get(id) }])
    );
    return {
      label: this.label,
      ts: new Date().toISOString(),
      active_tunnels: this.activeTunnels.size,
      active_tunnel_ids,
      active_streams: this.activeStreams.size,
      bytes_in_total: this.bytesInTotal,
      bytes_out_total: this.bytesOutTotal,
      backpressure_events_total: this.backpressureEventsTotal,
      buffered_bytes_total: total,
      buffered_bytes_per_tunnel: perTunnel,
      frame_too_large_total: this.frameTooLargeTotal,
      tunnel_disconnect_total: this.tunnelDisconnectTotal,
      heartbeat_timeout_total: this.heartbeatTimeoutTotal,
      stream_stall_cleanup_total: this.streamStallCleanupTotal,
      event_loop_lag_ms: this._loopLagPercentiles(),
      tunnels_detail,
    };
  }

  /** Structured single-line summary at debug level, safe to leave on. */
  startSummaryTimer(intervalMs = 30000) {
    if (this._summaryTimer) return;
    this._summaryTimer = setInterval(() => {
      logger.debug(`[metrics] ${JSON.stringify(this.snapshot())}`);
    }, intervalMs);
    this._summaryTimer.unref?.();
  }

  stopSummaryTimer() {
    if (this._summaryTimer) clearInterval(this._summaryTimer);
    this._summaryTimer = null;
  }

  dispose() {
    this.stopSummaryTimer();
    try {
      this._loopMonitor.disable();
    } catch (_) {}
  }

  reset() {
    this.activeTunnels.clear();
    this.activeStreams.clear();
    this._buffered.clear();
    this.bytesInTotal = 0;
    this.bytesOutTotal = 0;
    this.backpressureEventsTotal = 0;
    this.frameTooLargeTotal = 0;
    this.tunnelDisconnectTotal = 0;
    this.heartbeatTimeoutTotal = 0;
    this.streamStallCleanupTotal = 0;
  }
}

/** Shared process-wide instance used by server and client runtimes. */
let defaultInstance = null;

function getMetrics() {
  if (!defaultInstance) defaultInstance = new TunnelMetrics();
  return defaultInstance;
}

/** Test isolation helper. */
function resetMetrics() {
  if (defaultInstance) defaultInstance.reset();
  return getMetrics();
}

module.exports = {
  TunnelMetrics,
  getMetrics,
  resetMetrics,
};

/**
 * Tunnel buffering/backpressure limits.
 *
 * Single source of truth for every bounded-buffer threshold used by the
 * tunnel. Resolution order (lowest to highest priority):
 *   1. Built-in defaults
 *   2. RWT_* environment variables
 *   3. Programmatic overrides passed to getTunnelLimits()
 *
 * All byte values are plain integers (bytes). Timeouts are milliseconds.
 */

const M = 1024 * 1024;

const DEFAULT_LIMITS = Object.freeze({
  /** Pause the TCP producer when bytes handed to the WS reach this. */
  highWatermarkBytes: 8 * M,
  /** Resume the TCP producer when outstanding drops back to this. */
  lowWatermarkBytes: 2 * M,
  /** Hard cap on a single tunnel frame length field (before allocating). */
  maxFrameSizeBytes: M,
  /** Max bytes queued for one stream (WS-bound or TCP-bound queue). */
  maxBufferPerStreamBytes: 64 * M,
  /** Max bytes queued across all streams of a single tunnel. */
  maxBufferPerTunnelBytes: 256 * M,
  /** Process-wide safety ceiling (log-only enforcement trigger). */
  maxBufferPerProcessBytes: 512 * M,
  /** Idle close for per-request TCP clients on the agent side. */
  tcpIdleTimeoutMs: 60 * 1000,
});

const ENV_KEYS = {
  highWatermarkBytes: 'RWT_HIGH_WATERMARK',
  lowWatermarkBytes: 'RWT_LOW_WATERMARK',
  maxFrameSizeBytes: 'RWT_MAX_FRAME_SIZE',
  maxBufferPerStreamBytes: 'RWT_MAX_BUFFER_PER_STREAM',
  maxBufferPerTunnelBytes: 'RWT_MAX_BUFFER_PER_TUNNEL',
  maxBufferPerProcessBytes: 'RWT_MAX_BUFFER_PER_PROCESS',
  tcpIdleTimeoutMs: 'RWT_TCP_IDLE_TIMEOUT_MS',
};

function readEnvLimits(env = process.env) {
  const out = {};
  for (const [key, envName] of Object.entries(ENV_KEYS)) {
    const raw = env[envName];
    if (raw === undefined || raw === '') continue;
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) {
      throw new Error(`Invalid ${envName}="${raw}": must be a positive number`);
    }
    out[key] = num;
  }
  return out;
}

function assertConsistent(limits) {
  if (limits.lowWatermarkBytes >= limits.highWatermarkBytes) {
    throw new Error(
      `lowWatermark (${limits.lowWatermarkBytes}) must be < highWatermark (${limits.highWatermarkBytes})`
    );
  }
  if (limits.maxBufferPerStreamBytes > limits.maxBufferPerTunnelBytes) {
    throw new Error(
      `maxBufferPerStream (${limits.maxBufferPerStreamBytes}) cannot exceed maxBufferPerTunnel (${limits.maxBufferPerTunnelBytes})`
    );
  }
}

/**
 * Resolve effective limits. Throws on invalid values so misconfiguration
 * fails fast at startup instead of silently disabling a protection.
 * @param {Partial<typeof DEFAULT_LIMITS>} [overrides]
 * @param {NodeJS.ProcessEnv} [env]
 */
function getTunnelLimits(overrides, env = process.env) {
  const merged = {
    ...DEFAULT_LIMITS,
    ...readEnvLimits(env),
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid limit ${key}=${value}: must be a positive number`);
    }
  }
  assertConsistent(merged);
  return Object.freeze(merged);
}

module.exports = {
  DEFAULT_LIMITS,
  ENV_KEYS,
  getTunnelLimits,
};

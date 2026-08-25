const net = require('net');
const cookie = require('cookie');
const { WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { HTTPParser, methods } = require('http-parser-js');
const state = require('./state');
const { logger } = require('../utils/logger');
const { createBackpressureSender } = require('../utils/backpressureSender');
const { createStreamWriteQueue } = require('../utils/streamWriteQueue');
const { getTunnelLimits } = require('../utils/tunnelLimits');
const { getMetrics } = require('../utils/tunnelMetrics');

// Resolved once per process; RWT_* env overrides still apply.
const LIMITS = getTunnelLimits();
const METRICS = getMetrics();

// Small request bodies are held briefly and merged into one WS frame to
// cut per-message overhead; large bodies stream through immediately.
const BODY_COALESCE_BYTES = 64 * 1024;
const BODY_COALESCE_MS = 5;

function startTCPServer(port, tunnelIdHeaderName, websocketPort) {
  const wsPortKey = String(websocketPort);
  const tcpPortKey = String(port);

  const server = net.createServer(
    {
      // Allow reusing the port quickly after server closes (SO_REUSEADDR)
      // This helps with Node-RED restarts where old server might be in TIME_WAIT
      // Note: On some OS, you may also need to handle EADDRINUSE by waiting a bit
    },
    socket => {
      const uuid = uuidv4();
      let currentTunnelId = null;
      let isWebSocket = false;
      // When the incoming request uses Transfer-Encoding: chunked,
      // http-parser-js hands us the ALREADY-DECODED body. Since we forward
      // the original headers verbatim (still declaring chunked), we must
      // re-frame every forwarded body piece as an HTTP chunk.
      let chunkedMode = false;

      const CHUNK_CRLF = Buffer.from('\r\n');
      const CHUNK_TRAILER = Buffer.from('0\r\n\r\n');

      /**
       * Per-stream runtime object. Created once, lazily, when the tunnel
       * is first resolved; owns the bounded write queue (WS -> TCP) and
       * the backpressure-aware sender (TCP -> WS).
       */
      let conn = null;
      let bodyCoalescer = null;

      logger.debug(`New TCP connection on port ${port} with uuid ${uuid}`);

      function resolveTunnel() {
        return state[wsPortKey]?.websocketTunnels?.[currentTunnelId];
      }

      function ensureConn(tunnel) {
        if (conn) return conn;
        conn = {
          socket,
          stats: { openedAt: Date.now(), bytesIn: 0, bytesOut: 0 },
        };

        // TCP -> WS direction. The sender pauses THIS socket when the
        // agent's WS link falls behind, and resumes it below the low
        // watermark; reconcile() guards against stuck resume signals.
        conn.sender = createBackpressureSender({
          ws: tunnel.ws,
          tunnelId: currentTunnelId,
          uuid,
          limits: LIMITS,
          metrics: METRICS,
          onPause: () => {
            if (!socket.destroyed && !socket.isPaused()) socket.pause();
          },
          onResume: () => {
            if (!socket.destroyed && conn && socket.isPaused()) {
              try {
                socket.resume();
              } catch (_) {}
            }
          },
        });

        // WS -> TCP direction. Bounded FIFO preserving order; a stream
        // that exceeds its budget is closed controllably (CLOSE frame +
        // local teardown) instead of buffering without limit or killing
        // the whole tunnel.
        conn.queue = createStreamWriteQueue({
          socket,
          tunnelId: currentTunnelId,
          uuid,
          limits: LIMITS,
          metrics: METRICS,
          onOverflow: scope => {
            logger.warn(
              `[buffer_limit_reached] scope=${scope} tunnel=${currentTunnelId} uuid=${uuid} — closing stream controllably`
            );
            try {
              conn?.sender?.send('CLOSE');
            } catch (_) {}
            socket.destroy();
          },
        });

        tunnel.tcpConnections[uuid] = conn;
        METRICS.registerStream(currentTunnelId, uuid);
        logger.debug(`[stream_open] tunnel=${currentTunnelId} uuid=${uuid}`);
        return conn;
      }

      function cleanupConn(reason) {
        if (!conn) return;
        const c = conn;
        conn = null;
        c.queue?.destroy();
        c.sender?.destroy();
        if (currentTunnelId) {
          METRICS.unregisterStream(currentTunnelId, uuid);
        }
        delete state[wsPortKey]?.websocketTunnels?.[currentTunnelId]?.tcpConnections?.[uuid];
        logger.debug(
          `[stream_close] reason=${reason} tunnel=${currentTunnelId} uuid=${uuid} ` +
            `bytesIn=${c.stats.bytesIn}B bytesOut=${c.stats.bytesOut}B duration=${Date.now() - c.stats.openedAt}ms`
        );
      }

      function makeBodyCoalescer() {
        let buf = Buffer.alloc(0);
        let pendingBytes = 0;
        let timer = null;
        const flush = () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          if (buf.length === 0) return;
          sendBody(buf);
          buf = Buffer.alloc(0);
          pendingBytes = 0;
        };
        return {
          push(chunk) {
            buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
            pendingBytes += chunk.length;
            if (pendingBytes >= BODY_COALESCE_BYTES) {
              flush();
            } else if (!timer) {
              timer = setTimeout(flush, BODY_COALESCE_MS);
            }
          },
          flush,
        };
      }

      /**
       * Wraps a decoded body piece into HTTP chunked framing when the
       * original request declared Transfer-Encoding: chunked.
       */
      function sendBody(buf) {
        if (!chunkedMode) {
          return sendData(buf);
        }
        const head = Buffer.from(`${buf.length.toString(16)}\r\n`);
        return sendData(Buffer.concat([head, buf, CHUNK_CRLF]));
      }

      /**
       * Sends a DATA frame for this stream through the backpressure-aware
       * sender. Returns false when the tunnel link is gone.
       */
      function sendData(payload) {
        const tunnel = resolveTunnel();
        if (!tunnel?.ws || tunnel.ws.readyState !== WebSocket.OPEN) {
          return false;
        }
        const c = ensureConn(tunnel);
        const sent = c.sender.send(payload);
        if (sent !== null) {
          c.stats.bytesOut += payload.length;
          return true;
        }
        return false;
      }

      function createParser() {
        const parser = new HTTPParser(HTTPParser.REQUEST);

        parser[HTTPParser.kOnHeadersComplete] = info => {
          const headers = info.headers.reduce((acc, val, i, arr) => {
            if (i % 2 === 0) acc[val.toLowerCase()] = arr[i + 1];
            return acc;
          }, {});

          const methodName = methods[info.method] || 'UNKNOWN';

          // Tunnel ID via header or cookie
          if (headers[tunnelIdHeaderName]) {
            currentTunnelId = headers[tunnelIdHeaderName];
          } else if (headers['cookie']) {
            currentTunnelId = cookie.parse(headers['cookie'])[tunnelIdHeaderName];
          }

          const tunnel = resolveTunnel();

          if (!tunnel?.ws) {
            logger.warn(`Invalid or missing tunnel ID: ${currentTunnelId}, closing socket.`);
            socket.destroy();
            return;
          }

          if (!tunnel.tcpConnections[uuid]) {
            ensureConn(tunnel);
          }

          const rawHeaders =
            `${methodName} ${info.url} HTTP/${info.versionMajor}.${info.versionMinor}\r\n` +
            info.headers
              .map((v, i) => (i % 2 === 0 ? `${v}: ${info.headers[i + 1]}` : null))
              .filter(Boolean)
              .join('\r\n') +
            '\r\n\r\n';

          isWebSocket = headers['upgrade']?.toLowerCase() === 'websocket';
          chunkedMode = /chunked/i.test(String(headers['transfer-encoding'] || ''));

          logger.trace(
            `Sending initial headers (${rawHeaders.length} bytes) to tunnel [${currentTunnelId}]`
          );
          sendData(rawHeaders);

          if (isWebSocket) parser.close();
        };

        parser[HTTPParser.kOnBody] = (chunk, offset, length) => {
          const tunnel = resolveTunnel();
          if (tunnel?.ws && !isWebSocket) {
            const body = chunk.slice(offset, offset + length);
            logger.trace(`Forwarding body (${body.length} bytes) to tunnel [${currentTunnelId}]`);
            if (!bodyCoalescer) bodyCoalescer = makeBodyCoalescer();
            bodyCoalescer.push(body);
          }
        };

        parser[HTTPParser.kOnMessageComplete] = () => {
          if (!isWebSocket) {
            logger.trace(`HTTP message complete for tunnel [${currentTunnelId}]`);
            if (bodyCoalescer) {
              bodyCoalescer.flush();
              bodyCoalescer = null;
            }
            if (chunkedMode) {
              sendData(CHUNK_TRAILER);
              chunkedMode = false;
            }
            currentParser = createParser();
          }
        };

        return parser;
      }

      let currentParser = createParser();

      socket.on('data', chunk => {
        if (isWebSocket) {
          logger.trace(
            `Forwarding WebSocket TCP data (${chunk.length} bytes) for tunnel [${currentTunnelId}]`
          );
          sendData(chunk);
        } else {
          try {
            currentParser.execute(chunk);
          } catch (err) {
            logger.error(`HTTP parse error on tunnel [${currentTunnelId}]:`, err);
            socket.destroy();
          }
        }
      });

      socket.on('end', () => {
        logger.debug(`TCP socket end for tunnel [${currentTunnelId}] (uuid: ${uuid})`);
        sendData('CLOSE');
      });

      socket.on('close', () => {
        cleanupConn('close');
      });

      socket.on('error', err => {
        logger.error(`Socket error on tunnel [${currentTunnelId}], uuid [${uuid}]:`, err);
        cleanupConn('error');
      });
    }
  );

  // Note: We don't store the server reference here because the state structure
  // doesn't exist yet (it's created in messageHandler.js AFTER this function returns).
  // The caller (messageHandler.js) is responsible for storing the server reference.

  // Return a promise that resolves when listening or rejects on error
  return new Promise((resolve, reject) => {
    server.on('listening', () => {
      logger.info(`TCP server listening on port ${port} for websocketPort ${websocketPort}`);
      resolve(server);
    });

    server.on('error', err => {
      logger.error(`TCP server error on port ${port}:`, err);
      reject(err);
    });

    // Use reuseAddr to allow quick port reuse after server restart (TIME_WAIT)
    // This helps with Node-RED restarts where the old server might be in TIME_WAIT state
    server.listen(
      {
        port: port,
        host: '0.0.0.0',
        reuseAddr: true,
      },
      () => {
        // The server.address() returns the actual port bound (handles port === 0 case)
        const addr = server.address();
        logger.info(`TCP server listening on port ${addr.port} for websocketPort ${websocketPort}`);
        resolve(server);
      }
    );
  });
}

/**
 * Forcefully kills any process using the specified port by connecting to it
 * and keeping the connection open briefly, then attempts to bind the port.
 * This helps release the port from a previous process.
 *
 * @param {number} port - The port to clear
 * @returns {Promise<boolean>} True if we successfully cleared the port
 */
async function forceClosePort(port) {
  return new Promise(resolve => {
    const socket = new net.Socket();

    socket.setTimeout(500);

    socket.on('connect', () => {
      // Connected to existing server - destroy it and try to take over
      socket.destroy();

      // Now try to bind to the port - this should cause the OS to close the old server
      const takeover = net.createServer();
      takeover.on('error', err => {
        if (err.code === 'EADDRINUSE') {
          // Try again with a different approach - wait a bit
          setTimeout(() => resolve(true), 100);
        } else {
          resolve(false);
        }
      });

      takeover.on('listening', () => {
        // We got the port! Close our temp server
        takeover.close(() => resolve(true));
      });

      takeover.listen(port);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.connect(port, '127.0.0.1');
  });
}

/**
 * Ensures a TCP server is available on the specified port.
 * If a server is already listening on the port (from a previous process),
 * it will be forcefully closed before creating a new one.
 *
 * @param {number} port - The TCP port to bind to
 * @param {string} tunnelIdHeaderName - Header name for tunnel identification
 * @param {number} websocketPort - The WebSocket port (used as state key)
 * @returns {Promise<net.Server>} The TCP server instance
 */
async function ensureTCPServer(port, tunnelIdHeaderName, websocketPort) {
  const maxRetries = 5;
  const retryDelay = 300;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Try to start the TCP server
      return await startTCPServer(port, tunnelIdHeaderName, websocketPort);
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        logger.warn(
          `Port ${port} in use (attempt ${attempt}/${maxRetries}), attempting to force close...`
        );

        // Try to force close the port
        await forceClosePort(port);

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      } else {
        throw err;
      }
    }
  }

  // Last attempt - don't catch, let it fail
  return startTCPServer(port, tunnelIdHeaderName, websocketPort);
}

module.exports = { startTCPServer, ensureTCPServer, forceClosePort };

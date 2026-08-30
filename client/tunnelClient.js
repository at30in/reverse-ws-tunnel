const WebSocket = require('ws');
const { EventEmitter } = require('events');
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const { buildMessageBuffer } = require('./utils');
const { logger } = require('../utils/logger');
const { FrameParser, FrameSizeError } = require('../utils/frameParser');
const { getTunnelLimits } = require('../utils/tunnelLimits');
const { getMetrics } = require('../utils/tunnelMetrics');
const { createBackpressureSender, applyWsBufferGuard } = require('../utils/backpressureSender');
const { createStreamWriteQueue } = require('../utils/streamWriteQueue');
const packageJson = require('../package.json');

// Resolved once per process; RWT_* env overrides still apply.
const LIMITS = getTunnelLimits();
const METRICS = getMetrics();

const MESSAGE_TYPE_CONFIG = 0x01;
const MESSAGE_TYPE_DATA = 0x02;
const MESSAGE_TYPE_APP_PING = 0x03;
const MESSAGE_TYPE_APP_PONG = 0x04;
const clients = {};
const PING_INTERVAL = 30 * 1000; //30s
const PONG_WAIT = 5 * 1000; //5s
const APP_PING_INTERVAL = 20 * 1000; // 20 secondi
const HEALTH_TIMEOUT = 45 * 1000; // 45 secondi sliding window
const RECONNECT_BACKOFF = [1000, 2000, 5000, 10000, 30000]; // Backoff progressivo

/**
 * Starts WebSocket tunnel client.
 * @param {Object} config - Configuration for tunnel.
 */
function connectWebSocket(config) {
  const {
    wsUrl,
    tunnelId,
    targetUrl,
    targetPort,
    tunnelEntryUrl,
    tunnelEntryPort,
    headers,
    environment,
    autoReconnect = true,
  } = config;

  const eventEmitter = new EventEmitter();
  let ws;
  let pingInterval;
  let appPingInterval;
  let healthMonitor;
  let cleanupPong;
  let isClosed = false;
  let reconnectAttempt = 0;

  if (!tunnelId) {
    throw new Error(`Missing mandatory tunnelId`);
  }

  const connect = () => {
    if (isClosed) return;

    try {
      // Parse headers - handle both string and object formats
      let headersParsed = {};
      if (headers) {
        if (typeof headers === 'string') {
          try {
            headersParsed = JSON.parse(headers);
          } catch (e) {
            logger.warn(`Failed to parse headers string: ${headers}`);
          }
        } else if (typeof headers === 'object') {
          headersParsed = headers;
        }
      }
      logger.debug(`Parsed headers: ${JSON.stringify(headersParsed)}`);
      logger.debug(`Try to connect to: ${wsUrl}`);
      ws = new WebSocket(wsUrl, { headers: headersParsed });
      logger.debug(`Connection: ${wsUrl}`);
    } catch (error) {
      logger.error('Failed to create WebSocket connection:', error);
      return;
    }

    // PingState condiviso tra heartbeat e message handler
    // Reset completo dello stato per ogni connessione
    const pingState = {
      pingSeq: 0,
      lastPongTs: Date.now(),
    };
    const pingStateCallbacks = {
      pingSeq: () => pingState.pingSeq,
      incPingSeq: () => pingState.pingSeq++,
      lastPongTs: () => pingState.lastPongTs,
      setLastPongTs: ts => (pingState.lastPongTs = ts),
    };

    ws.on('open', () => {
      logger.info(`Connected to WebSocket server ${wsUrl}`);
      logger.warn(
        `WS tunnel config sent: TARGET_PORT=${targetPort}, ENTRY_PORT=${tunnelEntryPort}`
      );

      // Catastrophic backstop on the client side as well.
      applyWsBufferGuard(ws, LIMITS);

      // Reset reconnect attempt on successful connection
      reconnectAttempt = 0;

      eventEmitter.emit('connected');
      ({ pingInterval, cleanupPong } = heartBeat(ws));

      // Avviare heartbeat applicativo
      appPingInterval = startAppHeartbeat(ws, tunnelId, pingStateCallbacks);
      healthMonitor = startHealthMonitor(ws, tunnelId, {
        lastPongTs: () => pingState.lastPongTs,
        setLastPongTs: ts => (pingState.lastPongTs = ts),
      });

      const uuid = uuidv4();
      const payload = {
        TARGET_URL: targetUrl,
        TARGET_PORT: targetPort,
        TUNNEL_ENTRY_URL: tunnelEntryUrl,
        TUNNEL_ENTRY_PORT: tunnelEntryPort,
        environment,
        agentVersion: packageJson.version,
      };

      const message = buildMessageBuffer(
        tunnelId,
        uuid,
        MESSAGE_TYPE_CONFIG,
        JSON.stringify(payload)
      );
      logger.debug(`Sending tunnel config [uuid=${uuid}]`);
      ws.send(message);
    });

    const frameParser = new FrameParser({ maxFrameSizeBytes: LIMITS.maxFrameSizeBytes });

    ws.on('message', data => {
      logger.trace(`Received message chunk: ${data.length} bytes`);

      let frames;
      try {
        frames = frameParser.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      } catch (err) {
        if (err instanceof FrameSizeError) {
          METRICS.countFrameTooLarge();
          logger.warn(
            `[frame_too_large] declared=${err.declaredLength}B limit=${err.maxFrameSizeBytes}B — closing connection`
          );
          ws.close(1009, 'invalid frame size');
          return;
        }
        throw err;
      }

      for (let i = 0; i < frames.length; i++) {
        const { tunnelId: messageTunnelId, uuid, type, payload } = frames[i];

        // Validate tunnelId matches expected tunnel
        if (messageTunnelId.trim() !== tunnelId) {
          logger.warn(
            `Received message for wrong tunnel: ${messageTunnelId} (expected: ${tunnelId})`
          );
          return;
        }

        logger.trace(
          `Received WS message for uuid=${uuid}, type=${type}, length=${payload.length}`
        );

        if (type === MESSAGE_TYPE_DATA) {
          // Peer closed its entry socket: propagate FIN to the target.
          if (payload.length === 5 && payload.toString() === 'CLOSE') {
            logger.debug(`Received CLOSE for uuid=${uuid}`);
            const conn = clients[uuid];
            if (conn) {
              conn.queue?.destroy();
              conn.sender?.destroy();
              conn.socket.end();
              delete clients[uuid];
              METRICS.unregisterStream(tunnelId, uuid);
            }
            continue;
          }

          const conn = clients[uuid] || createTcpClient(targetUrl, targetPort, ws, tunnelId, uuid);

          // Bounded, order-preserving write toward the target service.
          if (conn.queue && !conn.queue.isDestroyed()) {
            if (conn.queue.enqueue(payload)) {
              if (conn.stats) conn.stats.bytesIn += payload.length;
            } else {
              logger.debug(
                `[buffer_limit_reached] DATA rejected for uuid=${uuid} (stream closing)`
              );
            }
          } else {
            // Legacy/defensive path (conn without a queue).
            conn.socket.write(payload);
            if (conn.stats) conn.stats.bytesIn += payload.length;
          }
          continue;
        } else if (type === MESSAGE_TYPE_APP_PONG) {
          try {
            const pongData = JSON.parse(payload.toString());
            // Accetta solo pong con seq >= pingSeq - 10 (finestra di 10 ping)
            if (pongData.seq >= pingStateCallbacks.pingSeq() - 10) {
              // Aggiorna lastPongTs usando il callback
              pingStateCallbacks.setLastPongTs(Date.now());
              logger.trace(`App pong received: seq=${pongData.seq}`);
            } else {
              logger.debug(`Ignoring old pong: seq=${pongData.seq}`);
            }
          } catch (err) {
            logger.error(`Invalid app pong format: ${err.message}`);
          }
          continue;
        }
      }
    });

    ws.on('close', () => {
      logger.warn('WebSocket connection closed. Cleaning up clients.');
      eventEmitter.emit('disconnected');
      clearInterval(pingInterval);
      clearInterval(appPingInterval);
      clearInterval(healthMonitor);
      if (cleanupPong) cleanupPong();

      destroyAllClients('ws_closed');

      if (!isClosed && autoReconnect) {
        const delay =
          RECONNECT_BACKOFF[reconnectAttempt] || RECONNECT_BACKOFF[RECONNECT_BACKOFF.length - 1];
        logger.info(`Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempt + 1})`);
        setTimeout(() => {
          reconnectAttempt = Math.min(reconnectAttempt + 1, RECONNECT_BACKOFF.length);
          connect();
        }, delay);
      }
    });

    ws.on('error', err => {
      logger.error('WebSocket error:', err);
    });
  };

  connect();

  eventEmitter.close = () => {
    isClosed = true;
    if (ws) {
      ws.terminate();
    }
  };

  return eventEmitter;
}

/**
 * Sets up heartbeat (ping/pong) mechanism.
 */
function heartBeat(ws) {
  let pongHandler = null;
  let pongTimeout = null;

  const cleanupPong = () => {
    if (pongTimeout) {
      clearTimeout(pongTimeout);
      pongTimeout = null;
    }
    if (pongHandler) {
      ws.removeListener('pong', pongHandler);
      pongHandler = null;
    }
  };

  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      cleanupPong();

      ws.ping();
      logger.trace('Sent WebSocket ping');

      pongTimeout = setTimeout(() => {
        logger.warn('No pong received. Terminating connection.');
        cleanupPong();
        ws.terminate();
      }, PONG_WAIT);

      pongHandler = () => {
        logger.trace('Received WebSocket pong');
        clearTimeout(pongTimeout);
        pongTimeout = null;
        pongHandler = null;
      };
      ws.once('pong', pongHandler);

      // Safety net against stuck backpressure: reconcile every stream
      // sender's outstanding bytes with real ws.bufferedAmount.
      for (const uuid of Object.keys(clients)) {
        clients[uuid]?.sender?.reconcile();
      }

      // Stream health check: detect streams that are paused with an empty
      // ws buffer and no progress for longer than staleMs. These streams
      // are truly stalled (e.g. target half-open) and must be destroyed.
      const staleMs = LIMITS.tcpIdleTimeoutMs || 60000;
      for (const uuid of Object.keys(clients)) {
        const conn = clients[uuid];
        if (!conn?.sender || conn.sender.isDestroyed()) continue;
        if (!conn.sender.isPaused()) continue;
        if (ws.bufferedAmount > 0) continue;
        const lastProgress = conn.sender.getLastProgressTs();
        if (Date.now() - lastProgress >= staleMs) {
          logger.warn(
            `[stream_stall] uuid=${uuid} paused for ${Date.now() - lastProgress}ms ` +
              `with empty ws buffer — destroying stream`
          );
          METRICS.countStreamStallCleanup();
          delete clients[uuid];
          conn.queue?.destroy();
          conn.sender?.destroy();
          try {
            conn.socket.destroy();
          } catch (_) {}
          METRICS.unregisterStream(tunnelId, uuid);
        }
      }
    }
  }, PING_INTERVAL);

  return { pingInterval, cleanupPong };
}

/**
 * Creates a TCP connection to the target service, wired with the bounded
 * write queue (WS -> target) and the backpressure-aware sender
 * (target -> WS). Registers the per-stream runtime in the clients map.
 */
function createTcpClient(targetUrl, targetPort, ws, tunnelId, uuid) {
  const hostname = new URL(targetUrl).hostname;
  logger.debug(`Creating TCP connection to ${hostname}:${targetPort} for uuid=${uuid}`);

  const client = net.createConnection(targetPort, hostname);
  const stats = { openedAt: Date.now(), bytesIn: 0, bytesOut: 0 };

  // target -> WS direction: pause this socket while the WS link is behind.
  const sender = createBackpressureSender({
    ws,
    tunnelId,
    uuid,
    limits: LIMITS,
    metrics: METRICS,
    onPause: () => {
      if (!client.destroyed && !client.isPaused?.()) client.pause();
    },
    onResume: () => {
      if (!client.destroyed && client.isPaused?.()) client.resume();
    },
  });

  // WS -> target direction: bounded FIFO; overflow closes THIS stream
  // controllably (CLOSE frame + local teardown), never the whole tunnel.
  const queue = createStreamWriteQueue({
    socket: client,
    tunnelId,
    uuid,
    limits: LIMITS,
    metrics: METRICS,
    onOverflow: scope => {
      logger.warn(
        `[buffer_limit_reached] scope=${scope} uuid=${uuid} — closing stream controllably`
      );
      try {
        sender.send('CLOSE');
      } catch (_) {}
      client.destroy();
    },
  });

  const conn = { socket: client, queue, sender, stats };
  clients[uuid] = conn;
  METRICS.registerStream(tunnelId, uuid);

  function cleanupLocal(reason) {
    if (clients[uuid] !== conn) return;
    delete clients[uuid];
    queue.destroy();
    sender.destroy();
    METRICS.unregisterStream(tunnelId, uuid);
    logger.debug(
      `[stream_close] reason=${reason} uuid=${uuid} bytesIn=${stats.bytesIn}B ` +
        `bytesOut=${stats.bytesOut}B duration=${Date.now() - stats.openedAt}ms`
    );
  }

  client.on('connect', () => {
    logger.info(`TCP connection established for uuid=${uuid}`);
  });

  client.on('data', data => {
    logger.trace(`TCP data received for uuid=${uuid}, length=${data.length}`);
    const sent = sender.send(data);
    if (sent !== null && stats) {
      stats.bytesOut += data.length;
    }
  });

  client.on('error', err => {
    logger.error(`TCP error for uuid=${uuid}:`, err);
    try {
      sender.send('CLOSE');
    } catch (_) {}
    cleanupLocal('error');
    client.destroy();
  });

  // Target sent FIN: propagate it to the server side so its entry socket
  // can half-close too.
  client.on('end', () => {
    logger.info(`TCP connection ended for uuid=${uuid}`);
    try {
      sender.send('CLOSE');
    } catch (_) {}
    cleanupLocal('end');
  });

  client.on('close', () => {
    cleanupLocal('close');
  });

  return conn;
}

/**
 * Tears down every open stream: bounded queues, senders and sockets.
 */
function destroyAllClients(reason) {
  for (const uuid of Object.keys(clients)) {
    const conn = clients[uuid];
    logger.debug(`Closing TCP connection for uuid=${uuid} (${reason})`);
    delete clients[uuid];
    conn.queue?.destroy();
    conn.sender?.destroy();
    try {
      conn.socket.destroy();
    } catch (_) {}
  }
}

/**
 * Starts the application-level heartbeat (ping every 20 seconds)
 */
function startAppHeartbeat(ws, tunnelId, pingState) {
  return setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      pingState.incPingSeq();
      const currentPingSeq = pingState.pingSeq();
      const pingData = JSON.stringify({
        type: 'ping',
        seq: currentPingSeq,
        ts: Date.now(),
      });

      const message = buildMessageBuffer(tunnelId, uuidv4(), MESSAGE_TYPE_APP_PING, pingData);
      ws.send(message);

      logger.trace(`App ping sent: seq=${currentPingSeq}`);
    }
  }, APP_PING_INTERVAL);
}

/**
 * Starts health monitoring with sliding window timeout
 */
function startHealthMonitor(ws, tunnelId, pongState) {
  return setInterval(() => {
    const now = Date.now();
    const currentLastPongTs = pongState.lastPongTs();
    if (now - currentLastPongTs > HEALTH_TIMEOUT) {
      logger.warn(`Health timeout exceeded (${HEALTH_TIMEOUT}ms) - terminating connection`);
      ws.terminate();
    }
  }, 5000); // Check every 5 seconds
}

function resetClients() {
  // for testing
  destroyAllClients('reset');
}

module.exports = {
  connectWebSocket,
  resetClients, // for testing
};

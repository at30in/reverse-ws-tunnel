const WebSocket = require('ws');
const { EventEmitter } = require('events');
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const { buildMessageBuffer } = require('./utils');
const { logger } = require('../utils/logger');
const packageJson = require('../package.json');

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

      // Reset reconnect attempt on successful connection
      reconnectAttempt = 0;

      eventEmitter.emit('connected');
      ({ pingInterval } = heartBeat(ws));

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

    let messageBuffer = Buffer.alloc(0);

    ws.on('message', data => {
      logger.trace(`Received message chunk: ${data.length} bytes`);
      messageBuffer = Buffer.concat([messageBuffer, data]);

      while (messageBuffer.length >= 4) {
        const length = messageBuffer.readUInt32BE(0);
        if (messageBuffer.length < 4 + length) {
          logger.trace(
            `Waiting for more data: need ${4 + length} bytes, have ${messageBuffer.length}`
          );
          break;
        }

        const message = messageBuffer.slice(4, 4 + length);
        messageBuffer = messageBuffer.slice(4 + length);

        const messageTunnelId = message.slice(0, 36).toString().trim();
        const uuid = message.slice(36, 72).toString();
        const type = message.readUInt8(72);
        const payload = message.slice(73);

        // Validate tunnelId matches expected tunnel
        if (messageTunnelId !== tunnelId) {
          logger.warn(
            `Received message for wrong tunnel: ${messageTunnelId} (expected: ${tunnelId})`
          );
          return;
        }

        logger.trace(
          `Received WS message for uuid=${uuid}, type=${type}, length=${payload.length}`
        );

        if (type === MESSAGE_TYPE_DATA) {
          if (payload.toString() === 'CLOSE') {
            logger.debug(`Received CLOSE for uuid=${uuid}`);
            if (clients[uuid]) {
              clients[uuid].end();
            }
            return;
          }

          const client =
            clients[uuid] || createTcpClient(targetUrl, targetPort, ws, tunnelId, uuid);

          if (!client.write(payload)) {
            logger.debug(`Backpressure on TCP socket for uuid=${uuid}`);
            client.once('drain', () => {
              logger.info(`TCP socket drained for uuid=${uuid}`);
            });
          }
          return;
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
          return;
        }
      }
    });

    ws.on('close', () => {
      logger.warn('WebSocket connection closed. Cleaning up clients.');
      eventEmitter.emit('disconnected');
      clearInterval(pingInterval);
      clearInterval(appPingInterval);
      clearInterval(healthMonitor);

      for (const uuid in clients) {
        logger.debug(`Closing TCP connection for uuid=${uuid}`);
        clients[uuid].end();
        clients[uuid].destroy();
        delete clients[uuid];
      }

      // Reset message buffer on close for proper reconnection
      messageBuffer = Buffer.alloc(0);

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
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
      logger.trace('Sent WebSocket ping');

      const pongTimeout = setTimeout(() => {
        logger.warn('No pong received. Terminating connection.');
        ws.terminate();
      }, PONG_WAIT);

      ws.once('pong', () => {
        logger.trace('Received WebSocket pong');
        clearTimeout(pongTimeout);
      });
    }
  }, PING_INTERVAL);

  return { pingInterval };
}

/**
 * Creates a TCP connection to target service.
 */
function createTcpClient(targetUrl, targetPort, ws, tunnelId, uuid) {
  const hostname = new URL(targetUrl).hostname;
  logger.debug(`Creating TCP connection to ${hostname}:${targetPort} for uuid=${uuid}`);

  const client = net.createConnection(targetPort, hostname);
  clients[uuid] = client;

  client.on('connect', () => {
    logger.info(`TCP connection established for uuid=${uuid}`);
  });

  client.on('data', data => {
    logger.trace(`TCP data received for uuid=${uuid}, length=${data.length}`);
    const message = buildMessageBuffer(tunnelId, uuid, MESSAGE_TYPE_DATA, data);
    ws.send(message);
  });

  client.on('error', err => {
    logger.error(`TCP error for uuid=${uuid}:`, err);
    client.destroy();
    delete clients[uuid];
  });

  client.on('end', () => {
    logger.info(`TCP connection ended for uuid=${uuid}`);
    delete clients[uuid];
  });

  return client;
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
  for (const key in clients) {
    delete clients[key];
  }
}

module.exports = {
  connectWebSocket,
  resetClients, // for testing
};

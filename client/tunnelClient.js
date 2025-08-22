const WebSocket = require('ws');
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const { buildMessageBuffer } = require('./utils');
const { logger } = require('../utils/logger');

const RECONNECT_INTERVAL = 5000;
const MESSAGE_TYPE_CONFIG = 0x01;
const MESSAGE_TYPE_DATA = 0x02;
const clients = {};
const PING_INTERVAL = 30 * 1000; //30s
const PONG_WAIT = 5 * 1000; //5s

/**
 * Starts the WebSocket tunnel client.
 * @param {Object} config - Configuration for tunnel.
 */
function connectWebSocket(config) {
  const { wsUrl, tunnelId, targetUrl, targetPort, tunnelEntryUrl, tunnelEntryPort, headers } = config;

  let ws;
  let pingInterval;

  if (!tunnelId) {
    throw new Error(`Missing mandatory tunnelId`);
  }

  try {
    const headersParsed = headers || '{}';
    logger.debug(`Parsed headers: ${JSON.stringify(headersParsed)}`);
    logger.debug(`Try to connect to: ${wsUrl}`);
    ws = new WebSocket(wsUrl, { headers: headersParsed });
    logger.debug(`Connection: ${wsUrl}`);
  } catch (error) {
    logger.error('Malformed headers:', error);
    return;
  }

  ws.on('open', () => {
    logger.info(`Connected to WebSocket server ${wsUrl}`);
    ({ pingInterval } = heartBeat(ws));

    const uuid = uuidv4();
    const payload = {
      TARGET_URL: targetUrl,
      TARGET_PORT: targetPort,
      TUNNEL_ENTRY_URL: tunnelEntryUrl,
      TUNNEL_ENTRY_PORT: tunnelEntryPort,
      environment: 'production',
      agentVersion: '1.0.0',
    };

    const message = buildMessageBuffer(tunnelId, uuid, MESSAGE_TYPE_CONFIG, JSON.stringify(payload));
    logger.debug(`Sending tunnel config [uuid=${uuid}]`);
    ws.send(message);
  });

  ws.on('message', (data) => {
    const uuid = data.slice(0, 36).toString();
    const type = data.readUInt8(36);
    const payload = data.slice(37);

    logger.trace(`Received WS message for uuid=${uuid}, type=${type}, length=${payload.length}`);

    if (type === MESSAGE_TYPE_DATA) {
      if (payload.toString() === 'CLOSE') {
        logger.debug(`Received CLOSE for uuid=${uuid}`);
        if (clients[uuid]) {
          clients[uuid].end();
        }
        return;
      }

      const client = clients[uuid] || createTcpClient(targetUrl, targetPort, ws, tunnelId, uuid);

      if (!client.write(payload)) {
        logger.debug(`Backpressure on TCP socket for uuid=${uuid}`);
        client.once('drain', () => {
          logger.info(`TCP socket drained for uuid=${uuid}`);
        });
      }
    }
  });

  ws.on('close', () => {
    logger.warn('WebSocket connection closed. Cleaning up clients.');
    clearInterval(pingInterval);

    for (const uuid in clients) {
      logger.debug(`Closing TCP connection for uuid=${uuid}`);
      clients[uuid].end();
      clients[uuid].destroy();
      delete clients[uuid];
    }

    logger.info(`Reconnecting in ${RECONNECT_INTERVAL / 1000}s...`);
    setTimeout(() => connectWebSocket(config), RECONNECT_INTERVAL);
  });

  ws.on('error', (err) => {
    logger.error('WebSocket error:', err);
  });
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
 * Creates a TCP connection to the target service.
 */
function createTcpClient(targetUrl, targetPort, ws, tunnelId, uuid) {
  const hostname = new URL(targetUrl).hostname;
  logger.debug(`Creating TCP connection to ${hostname}:${targetPort} for uuid=${uuid}`);

  const client = net.createConnection(targetPort, hostname);
  clients[uuid] = client;

  client.on('connect', () => {
    logger.info(`TCP connection established for uuid=${uuid}`);
  });

  client.on('data', (data) => {
    logger.trace(`TCP data received for uuid=${uuid}, length=${data.length}`);
    const message = buildMessageBuffer(tunnelId, uuid, MESSAGE_TYPE_DATA, data);
    ws.send(message);
  });

  client.on('error', (err) => {
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

module.exports = {
  connectWebSocket,
};

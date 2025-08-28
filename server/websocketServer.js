const WebSocket = require('ws');
const { Buffer } = require('buffer');
const state = require('./state');
const { handleParsedMessage } = require('./messageHandler');
const { PING_INTERVAL } = require('./constants');
const { logger } = require('../utils/logger');

/**
 * Starts the WebSocket tunnel server.
 * @param {Object} options
 * @param {number} options.port - Port to listen on.
 * @param {string} [options.host] - Host address to bind.
 * @param {string} [options.path] - WebSocket path.
 * @param {string} options.tunnelIdHeaderName - Header name for identifying the tunnel.
 */
function startWebSocketServer({ port, host, path, tunnelIdHeaderName }) {
  const portKey = String(port);

  state[portKey] = state[portKey] || {};
  state[portKey].websocketTunnels = state[portKey].websocketTunnels || {};

  state[portKey].webSocketServer = new WebSocket.Server({ port, host, path });

  state[portKey].webSocketServer.on('listening', () => {
    logger.info(`WebSocket server listening on port ${port}${host ? ` (host: ${host})` : ''}${path ? `, path: ${path}` : ''}`);
  });

  state[portKey].webSocketServer.on('connection', (ws, req) => {
    let tunnelId = null;
    let buffer = Buffer.alloc(0);

    const clientIp = req.socket.remoteAddress;
    logger.info(`WebSocket connection established from ${clientIp}`);

    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        logger.trace('Ping sent to client');
      }
    }, PING_INTERVAL);

    ws.on('message', (chunk) => {
      logger.trace(`Received message chunk: ${chunk.length} bytes`);
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (buffer.length < 4 + length) break;

        const message = buffer.slice(4, 4 + length);
        buffer = buffer.slice(4 + length);

        tunnelId = message.slice(0, 36).toString();
        const uuid = message.slice(36, 72).toString();
        const type = message.readUInt8(72);
        const payload = message.slice(73);

        logger.trace(`Parsed message - tunnelId: ${tunnelId}, uuid: ${uuid}, type: ${type}, payload length: ${payload.length}`);
        handleParsedMessage(ws, tunnelId, uuid, type, payload, tunnelIdHeaderName, portKey);
      }
    });

    ws.on('close', () => {
      logger.info(`WebSocket connection closed for tunnel [${tunnelId}]`);
      if (tunnelId) {
        delete state[portKey].websocketTunnels[tunnelId];
        logger.debug(`Removed tunnel [${tunnelId}] from state`);
      }
      clearInterval(interval);
    });

    ws.on('pong', () => {
      logger.debug(`Pong received from client on tunnel [${tunnelId || 'unknown'}]`);
    });

    ws.on('error', (err) => {
      logger.error(`WebSocket error on tunnel [${tunnelId || 'unknown'}]:`, err);
      clearInterval(interval);
    });
  });

  state[portKey].webSocketServer.on('error', (err) => {
    logger.error('WebSocket server error:', err);
  });

  return state;
}

module.exports = { startWebSocketServer };

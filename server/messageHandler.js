const state = require('./state');
const { MESSAGE_TYPE_CONFIG, MESSAGE_TYPE_DATA, MESSAGE_TYPE_APP_PING, MESSAGE_TYPE_APP_PONG } = require('./constants');
const { startTCPServer } = require('./tcpServer');
const { logger } = require('../utils/logger');
const { buildMessageBuffer } = require('../client/utils');

/**
 * Handles a parsed WebSocket message.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {string} tunnelId - Tunnel identifier.
 * @param {string} uuid - Unique identifier for TCP connection.
 * @param {number} type - Message type (config or data).
 * @param {Buffer} payload - Data payload.
 * @param {string} tunnelIdHeaderName - Header name to identify the tunnel.
 * @param {number} port - Listening port for state grouping.
 */
function handleParsedMessage(ws, tunnelId, uuid, type, payload, tunnelIdHeaderName, port) {
  logger.trace(`handleParsedMessage called. type=${type}, tunnelId=${tunnelId}, uuid=${uuid}`);

  if (type === MESSAGE_TYPE_CONFIG) {
    try {
      const config = JSON.parse(payload);
      logger.debug(`Received tunnel config for tunnelId=${tunnelId}: ${JSON.stringify(config)}`);

      const { TUNNEL_ENTRY_PORT } = config;

      if (!TUNNEL_ENTRY_PORT) {
        logger.warn(`Tunnel config missing TUNNEL_ENTRY_PORT for tunnelId=${tunnelId}`);
        throw new Error('Missing tunnel entry port!');
      }

      logger.debug(`Registering WebSocket tunnel [${tunnelId}] on port ${port}`);

      if (!state[port]) {
        state[port] = {
          websocketTunnels: {},
        };
      }

      if (!state[port].websocketTunnels) {
        state[port].websocketTunnels = {};
      }

      state[port].websocketTunnels[tunnelId] = {
        ws,
        tcpConnections: {},
        httpConnections: {},
      };

      const portKey = String(TUNNEL_ENTRY_PORT);
      if (!state[port][portKey]) {
        logger.info(`Starting new TCP server on port ${TUNNEL_ENTRY_PORT} for tunnelId=${tunnelId}`);
        state[port][portKey] = {};
        state[port][portKey] = {
          tcpServer: startTCPServer(TUNNEL_ENTRY_PORT, tunnelIdHeaderName, port),
        };
      } else {
        logger.debug(`TCP server already exists on port ${TUNNEL_ENTRY_PORT}`);
      }

      logger.info(`Tunnel [${tunnelId}] established successfully`);
    } catch (error) {
      logger.error(`Failed to process MESSAGE_TYPE_CONFIG for tunnelId=${tunnelId}: ${error.message}`);
    }

    return;
  }

  // Handle MESSAGE_TYPE_APP_PING
  if (type === MESSAGE_TYPE_APP_PING) {
    try {
      const pingData = JSON.parse(payload.toString());
      const pongData = JSON.stringify({
        type: 'pong',
        seq: pingData.seq
      });

      const pongMessage = buildMessageBuffer(tunnelId, uuid, MESSAGE_TYPE_APP_PONG, pongData);
      ws.send(pongMessage);

      logger.trace(`App pong sent: seq=${pingData.seq} for tunnel ${tunnelId}`);
    } catch (err) {
      logger.error(`Invalid app ping format for tunnel ${tunnelId}: ${err.message}`);
    }
    return;
  }

  // Handle MESSAGE_TYPE_DATA
  const tunnel = state[port]?.websocketTunnels?.[tunnelId];

  if (tunnel?.tcpConnections?.[uuid]?.socket) {
    logger.trace(`Forwarding data to TCP socket for uuid=${uuid}, tunnelId=${tunnelId}`);
    tunnel.tcpConnections[uuid].socket.write(payload);
  } else {
    logger.debug(`No TCP connection found for uuid=${uuid}, tunnelId=${tunnelId}`);
  }
}

module.exports = { handleParsedMessage };

const state = require('./state');
const {
  MESSAGE_TYPE_CONFIG,
  MESSAGE_TYPE_DATA,
  MESSAGE_TYPE_APP_PING,
  MESSAGE_TYPE_APP_PONG,
} = require('./constants');
const { ensureTCPServer } = require('./tcpServer');
const { logger } = require('../utils/logger');
const { buildMessageBuffer } = require('../client/utils');
const WebSocket = require('ws');

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
async function handleParsedMessage(ws, tunnelId, uuid, type, payload, tunnelIdHeaderName, port) {
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
        agentVersion: config.agentVersion || 'unknown',
      };

      const portKey = String(TUNNEL_ENTRY_PORT);
      // Check both state and global tcpServers registry
      logger.debug(`[TCP] Checking existing servers for portKey=${portKey}`);
      const existingServerInState = state[port]?.[portKey]?.tcpServer;
      const existingServerInGlobal = state.tcpServers[portKey];
      logger.debug(
        `[TCP] existingServerInState=${!!existingServerInState}, existingServerInGlobal=${!!existingServerInGlobal}`
      );

      const isServerListening =
        (existingServerInState && existingServerInState.listening) ||
        (existingServerInGlobal && existingServerInGlobal.listening);
      logger.debug(`[TCP] isServerListening=${isServerListening}`);

      if (!isServerListening) {
        // Close any stale TCP server in global registry before creating new one
        if (state.tcpServers[portKey] && state.tcpServers[portKey].listening) {
          logger.warn(
            `[TCP] Closing stale TCP server on port ${TUNNEL_ENTRY_PORT} before creating new one`
          );
          state.tcpServers[portKey].close();
        }

        // Use ensureTCPServer to handle port cleanup (EADDRINUSE after Node-RED restart)
        logger.info(
          `[TCP] Starting new TCP server on port ${TUNNEL_ENTRY_PORT} for tunnelId=${tunnelId}`
        );

        try {
          logger.info(`[TCP] >>> Calling ensureTCPServer for port ${TUNNEL_ENTRY_PORT} <<<`);
          const tcpServer = await ensureTCPServer(TUNNEL_ENTRY_PORT, tunnelIdHeaderName, port);
          logger.info(`[TCP] >>> ensureTCPServer returned for port ${TUNNEL_ENTRY_PORT} <<<`);

          // Store in state per port
          state[port][portKey] = { tcpServer };
          logger.debug(`[TCP] Stored in state[${port}][${portKey}]`);

          // Also register in global tcpServers registry for tracking
          state.tcpServers[portKey] = tcpServer;
          logger.info(
            `[TCP] >>> REGISTERED in global state.tcpServers: port ${portKey}, listening=${tcpServer.listening} <<<`
          );

          logger.info(
            `[TCP] TCP server ready on port ${TUNNEL_ENTRY_PORT} for tunnelId=${tunnelId}`
          );
        } catch (err) {
          logger.error(
            `[TCP] Failed to create TCP server on port ${TUNNEL_ENTRY_PORT}: ${err.message}`
          );
        }
      } else {
        logger.debug(`[TCP] TCP server already exists and listening on port ${TUNNEL_ENTRY_PORT}`);
      }

      logger.info(`Tunnel [${tunnelId}] established successfully`);
    } catch (error) {
      logger.error(
        `Failed to process MESSAGE_TYPE_CONFIG for tunnelId=${tunnelId}: ${error.message}`
      );
    }

    return;
  }

  // Handle MESSAGE_TYPE_APP_PING
  if (type === MESSAGE_TYPE_APP_PING) {
    try {
      const pingData = JSON.parse(payload.toString());
      const pongData = JSON.stringify({
        type: 'pong',
        seq: pingData.seq,
      });

      const pongMessage = buildMessageBuffer(tunnelId, uuid, MESSAGE_TYPE_APP_PONG, pongData);

      if (ws.readyState !== WebSocket.OPEN) {
        logger.debug(`APP_PONG dropped: ws.readyState=${ws.readyState} for tunnel ${tunnelId}`);
        return;
      }

      ws.send(pongMessage);

      logger.trace(`App pong sent: seq=${pingData.seq} for tunnel ${tunnelId}`);
    } catch (err) {
      logger.error(`Invalid app ping format for tunnel ${tunnelId}: ${err.message}`);
    }
    return;
  }

  // Handle MESSAGE_TYPE_DATA
  const tunnel = state[port]?.websocketTunnels?.[tunnelId];
  const conn = tunnel?.tcpConnections?.[uuid];

  if (conn?.socket) {
    // Agent signals target-side FIN (or controlled stream closure):
    // half-close the entry socket instead of writing literal bytes.
    if (payload.length === 5 && payload.toString() === 'CLOSE') {
      logger.debug(`Received CLOSE for uuid=${uuid}, ending entry socket`);
      conn.queue?.destroy();
      try {
        conn.socket.end();
      } catch (_) {}
      return;
    }

    logger.trace(`Forwarding data to TCP socket for uuid=${uuid}, tunnelId=${tunnelId}`);

    // Bounded, order-preserving write. The queue applies per-stream and
    // per-tunnel budgets; on overflow it closes this stream controllably
    // (its onOverflow hook sends CLOSE + tears the socket down).
    if (conn.queue && !conn.queue.isDestroyed()) {
      if (conn.queue.enqueue(payload)) {
        if (conn.stats) conn.stats.bytesIn += payload.length;
      } else {
        logger.debug(
          `[buffer_limit_reached] DATA rejected for uuid=${uuid}, tunnelId=${tunnelId} (stream closing)`
        );
      }
    } else {
      // Legacy/defensive path (conn without a queue).
      conn.socket.write(payload);
      if (conn.stats) conn.stats.bytesIn += payload.length;
    }
  } else {
    logger.debug(`No TCP connection found for uuid=${uuid}, tunnelId=${tunnelId}`);
  }
}

module.exports = { handleParsedMessage };

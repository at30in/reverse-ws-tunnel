const WebSocket = require('ws');
const { Buffer } = require('buffer');
const state = require('./state');
const { handleParsedMessage } = require('./messageHandler');
const { PING_INTERVAL } = require('./constants');
const { logger } = require('../utils/logger');
const { FrameParser, FrameSizeError } = require('../utils/frameParser');
const { getTunnelLimits } = require('../utils/tunnelLimits');
const { getMetrics } = require('../utils/tunnelMetrics');
const { applyWsBufferGuard } = require('../utils/backpressureSender');

// Resolved once per process; RWT_* env overrides still apply.
const LIMITS = getTunnelLimits();
const METRICS = getMetrics();

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
    logger.info(
      `WebSocket server listening on port ${port}${host ? ` (host: ${host})` : ''}${path ? `, path: ${path}` : ''}`
    );
  });

  state[portKey].webSocketServer.on('connection', (ws, req) => {
    let tunnelId = null;
    let tunnelRegistered = false;
    const parser = new FrameParser({ maxFrameSizeBytes: LIMITS.maxFrameSizeBytes });

    const clientIp = req.socket.remoteAddress;
    logger.info(`WebSocket connection established from ${clientIp}`);

    // Catastrophic backstop: the ws lib itself refuses to buffer beyond
    // this; normal flow control is enforced per-stream by our senders.
    applyWsBufferGuard(ws, LIMITS);

    // Setup heartbeat
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
      logger.debug(`Pong received from client on tunnel [${tunnelId || 'unknown'}]`);
    });

    const interval = setInterval(() => {
      if (!ws.isAlive) {
        logger.warn(
          `No pong received from client on tunnel [${tunnelId || 'unknown'}], terminating.`
        );
        return ws.terminate();
      }
      ws.isAlive = false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        logger.trace(`Ping sent to client on tunnel [${tunnelId || 'unknown'}]`);
      }
      // Safety net against stuck backpressure: reconcile every stream
      // sender's outstanding bytes with real ws.bufferedAmount.
      const conns = state[portKey]?.websocketTunnels?.[tunnelId]?.tcpConnections;
      if (conns) {
        for (const conn of Object.values(conns)) {
          conn.sender?.reconcile();
        }
      }
    }, PING_INTERVAL);

    ws.on('message', chunk => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      logger.trace(`Received message chunk: ${data.length} bytes`);

      let frames;
      try {
        frames = parser.push(data);
      } catch (err) {
        if (err instanceof FrameSizeError) {
          METRICS.countFrameTooLarge();
          logger.warn(
            `[frame_too_large] tunnel=${tunnelId || 'unknown'} declared=${err.declaredLength}B ` +
              `limit=${err.maxFrameSizeBytes}B — closing connection`
          );
          ws.close(1009, 'invalid frame size');
          return;
        }
        throw err;
      }

      for (let i = 0; i < frames.length; i++) {
        const { tunnelId: messageTunnelId, uuid, type, payload } = frames[i];
        logger.trace(
          `Parsed message - tunnelId: ${messageTunnelId}, uuid: ${uuid}, type: ${type}, payload length: ${payload.length}`
        );

        // Check for duplicate tunnelId on first message (when tunnelId is not yet set)
        if (!tunnelId && messageTunnelId) {
          const existingTunnel = state[portKey]?.websocketTunnels?.[messageTunnelId];
          if (existingTunnel && existingTunnel.ws && existingTunnel.ws !== ws) {
            // Check if the existing WebSocket is still open
            if (
              existingTunnel.ws.readyState === WebSocket.OPEN ||
              existingTunnel.ws.readyState === WebSocket.CONNECTING
            ) {
              logger.error(
                `Tunnel [${messageTunnelId}] already exists with an active connection. Rejecting new connection.`
              );

              // Assign tunnelId before closing so cleanup logs the correct value
              tunnelId = messageTunnelId;

              // Close the new connection immediately
              ws.close(1008, `Duplicate tunnelId: ${messageTunnelId}`);
              return;
            } else {
              logger.info(
                `Existing tunnel [${messageTunnelId}] has a closed connection. Allowing new connection.`
              );
            }
          }
          tunnelId = messageTunnelId;
          METRICS.registerTunnel(tunnelId);
          tunnelRegistered = true;
        }

        handleParsedMessage(ws, messageTunnelId, uuid, type, payload, tunnelIdHeaderName, portKey);
      }
    });

    function cleanup(reason = 'unknown') {
      logger.info(`Cleaning up tunnel [${tunnelId || 'unknown'}] (reason: ${reason})`);

      try {
        // Tear down every open stream of this tunnel first: sockets toward
        // internet clients, their bounded queues and senders. Prevents
        // leaked sockets/queues when the WSS connection dies mid-transfer.
        const tunnel = state[portKey]?.websocketTunnels?.[tunnelId];
        for (const [connUuid, conn] of Object.entries(tunnel?.tcpConnections || {})) {
          logger.debug(`[stream_close] reason=tunnel_${reason} uuid=${connUuid}`);
          conn.queue?.destroy();
          conn.sender?.destroy();
          try {
            conn.socket.destroy();
          } catch (_) {}
        }

        if (tunnelRegistered && tunnelId) {
          METRICS.unregisterTunnel(tunnelId);
        }

        if (tunnelId) {
          // Only remove from state if this WebSocket is the one actually registered
          const registeredTunnel = state[portKey]?.websocketTunnels?.[tunnelId];
          if (registeredTunnel && registeredTunnel.ws === ws) {
            delete state[portKey].websocketTunnels[tunnelId];
            logger.debug(`Removed tunnel [${tunnelId}] from state`);
          } else {
            logger.debug(
              `Tunnel [${tunnelId}] not removed - this was a duplicate/rejected connection`
            );
          }
        } else {
          logger.debug(`No tunnelId assigned yet, nothing to remove from state`);
        }
      } finally {
        // Always clear the heartbeat timer and terminate the WebSocket,
        // even if an earlier step throws. Do NOT call removeAllListeners()
        // here: the ws library uses its own internal close listener to
        // track clients in WebSocket.Server.clients. Removing it causes
        // Server.close() to wait forever for a client that can never be
        // de-registered.
        clearInterval(interval);

        try {
          ws.terminate();
        } catch (e) {
          logger.debug(`Error in ws.terminate:`, e);
        }
      }
    }

    ws.on('close', () => {
      logger.info(`WebSocket connection closed for tunnel [${tunnelId || 'unknown'}]`);
      cleanup('close');
    });

    ws.on('error', err => {
      logger.error(`WebSocket error on tunnel [${tunnelId || 'unknown'}]:`, err);
      cleanup('error');
    });
  });

  state[portKey].webSocketServer.on('error', err => {
    logger.error('WebSocket server error:', err);
  });

  return state;
}

/**
 * Stops the WebSocket tunnel server and cleans up all resources.
 * @param {number} port - Port of the WebSocket server to stop.
 * @returns {Promise<void>} Resolves when cleanup is complete.
 */
async function stopWebSocketServer(port) {
  const portKey = String(port);
  const serverState = state[portKey];

  if (!serverState) {
    logger.debug(`No server found on port ${port}, nothing to stop`);
    return;
  }

  logger.info(`Stopping WebSocket server on port ${port}...`);

  // 1. Close all active WebSocket connections (triggers cleanup for each tunnel)
  if (serverState.websocketTunnels) {
    for (const [tunnelId, tunnel] of Object.entries(serverState.websocketTunnels)) {
      if (tunnel.ws && tunnel.ws.readyState === WebSocket.OPEN) {
        tunnel.ws.close(1000, 'Server shutting down');
      }
    }
  }

  // 2. Close all TCP servers in per-port state
  logger.debug(
    `[CLEANUP] Checking per-port state for TCP servers. Keys: ${Object.keys(serverState).join(', ')}`
  );
  for (const [tcpPort, tcpState] of Object.entries(serverState)) {
    if (tcpPort !== 'webSocketServer' && tcpPort !== 'websocketTunnels' && tcpState?.tcpServer) {
      logger.info(`[CLEANUP] Closing TCP server in per-port state on port ${tcpPort}`);
      await new Promise(resolve => {
        tcpState.tcpServer.close(() => {
          logger.info(`[CLEANUP] Closed TCP server on port ${tcpPort}`);
          resolve();
        });
      });
    }
  }

  // 2b. Close all TCP servers in global tcpServers registry
  // This handles TCP servers that may not be in state yet (client not reconnected)
  // Note: We close ALL servers in registry, not just listening ones, because they may have been
  // closed in per-port cleanup but still exist in global registry
  const globalTcpServerCount = Object.keys(state.tcpServers || {}).length;
  logger.info(
    `[CLEANUP] Global tcpServers registry has ${globalTcpServerCount} entries: ${Object.keys(state.tcpServers || {}).join(', ')}`
  );
  if (state.tcpServers && globalTcpServerCount > 0) {
    for (const [tcpPort, tcpServer] of Object.entries(state.tcpServers)) {
      logger.info(
        `[CLEANUP] Checking global TCP server on port ${tcpPort}: exists=${!!tcpServer}, listening=${tcpServer?.listening}`
      );
      // Close any server that exists, regardless of listening state (it may have been closed in per-port cleanup)
      if (tcpServer) {
        if (tcpServer.listening) {
          logger.info(`[CLEANUP] Closing global TCP server on port ${tcpPort} (listening)...`);
          await new Promise(resolve => {
            tcpServer.close(() => {
              logger.info(`[CLEANUP] Closed global TCP server on port ${tcpPort}`);
              resolve();
            });
          });
        } else {
          // Server exists but not listening - it was already closed in per-port cleanup
          // Just log and clear from registry
          logger.info(
            `[CLEANUP] Global TCP server on port ${tcpPort} already closed (listening=false), clearing from registry`
          );
        }
      }
    }
    // Clear the global tcpServers registry
    state.tcpServers = {};
  }

  // 3. Close the main WebSocket server
  if (serverState.webSocketServer) {
    await new Promise(resolve => {
      serverState.webSocketServer.close(() => {
        logger.debug(`Closed WebSocket server on port ${port}`);
        resolve();
      });
    });
  }

  // 4. Clean up state
  delete state[portKey];
  logger.info(`WebSocket server on port ${port} stopped and state cleaned`);
}

module.exports = { startWebSocketServer, stopWebSocketServer };

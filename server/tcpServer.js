const net = require('net');
const cookie = require('cookie');
const { v4: uuidv4 } = require('uuid');
const { HTTPParser, methods } = require('http-parser-js');
const state = require('./state');
const { MESSAGE_TYPE_DATA } = require('./constants');
const { logger } = require('../utils/logger');
const { buildMessageBuffer } = require('../client/utils');

function startTCPServer(port, tunnelIdHeaderName, websocketPort) {
  const wsPortKey = String(websocketPort);
  const tcpPortKey = String(port);

  const server = net.createServer({ 
    pauseOnConnect: true,
    // Allow reusing the port quickly after server closes (SO_REUSEADDR)
    // This helps with Node-RED restarts where old server might be in TIME_WAIT
    // Note: On some OS, you may also need to handle EADDRINUSE by waiting a bit
  }, socket => {
    const uuid = uuidv4();
    const uuidBuffer = Buffer.from(uuid);
    let currentTunnelId = null;
    let isWebSocket = false;

    logger.debug(`New TCP connection on port ${port} with uuid ${uuid}`);

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

        const tunnel = state[wsPortKey]?.websocketTunnels?.[currentTunnelId];

        if (!tunnel?.ws) {
          logger.warn(`Invalid or missing tunnel ID: ${currentTunnelId}, closing socket.`);
          socket.destroy();
          return;
        }

        if (!tunnel.tcpConnections[uuid]) {
          tunnel.tcpConnections[uuid] = { socket };
          logger.debug(`Registered TCP connection [${uuid}] to tunnel [${currentTunnelId}]`);
        }

        const rawHeaders =
          `${methodName} ${info.url} HTTP/${info.versionMajor}.${info.versionMinor}\r\n` +
          info.headers
            .map((v, i) => (i % 2 === 0 ? `${v}: ${info.headers[i + 1]}` : null))
            .filter(Boolean)
            .join('\r\n') +
          '\r\n\r\n';

        isWebSocket = headers['upgrade']?.toLowerCase() === 'websocket';

        logger.trace(
          `Sending initial headers (${rawHeaders.length} bytes) to tunnel [${currentTunnelId}]`
        );
        const message = buildMessageBuffer(currentTunnelId, uuid, MESSAGE_TYPE_DATA, rawHeaders);
        tunnel.ws.send(message);

        if (isWebSocket) parser.close();
      };

      parser[HTTPParser.kOnBody] = (chunk, offset, length) => {
        const tunnel = state[wsPortKey]?.websocketTunnels?.[currentTunnelId];
        if (tunnel?.ws && !isWebSocket) {
          const body = chunk.slice(offset, offset + length);
          logger.trace(`Forwarding body (${body.length} bytes) to tunnel [${currentTunnelId}]`);
          const message = buildMessageBuffer(currentTunnelId, uuid, MESSAGE_TYPE_DATA, body);
          tunnel.ws.send(message);
        }
      };

      parser[HTTPParser.kOnMessageComplete] = () => {
        if (!isWebSocket) {
          logger.trace(`HTTP message complete for tunnel [${currentTunnelId}]`);
          currentParser = createParser();
        }
      };

      return parser;
    }

    let currentParser = createParser();

    socket.on('data', chunk => {
      const tunnel = state[wsPortKey]?.websocketTunnels?.[currentTunnelId];
      if (isWebSocket) {
        if (tunnel?.ws) {
          logger.trace(
            `Forwarding WebSocket TCP data (${chunk.length} bytes) for tunnel [${currentTunnelId}]`
          );
          const message = buildMessageBuffer(currentTunnelId, uuid, MESSAGE_TYPE_DATA, chunk);
          tunnel.ws.send(message);
        }
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
      const tunnel = state[wsPortKey]?.websocketTunnels?.[currentTunnelId];
      if (tunnel?.ws) {
        logger.debug(`TCP socket end for tunnel [${currentTunnelId}] (uuid: ${uuid})`);
        const message = buildMessageBuffer(currentTunnelId, uuid, MESSAGE_TYPE_DATA, 'CLOSE');
        tunnel.ws.send(message);
      }
    });

    socket.on('close', () => {
      const deleted =
        delete state[wsPortKey]?.websocketTunnels?.[currentTunnelId]?.tcpConnections?.[uuid];
      logger.debug(
        `TCP socket closed [${uuid}] for tunnel [${currentTunnelId}], connection ${deleted ? 'removed' : 'not found'}`
      );
    });

    socket.on('error', err => {
      logger.error(`Socket error on tunnel [${currentTunnelId}], uuid [${uuid}]:`, err);
      delete state[wsPortKey]?.websocketTunnels?.[currentTunnelId]?.tcpConnections?.[uuid];
    });
  });

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
    server.listen({
      port: port,
      host: '0.0.0.0',
      reuseAddr: true,
    }, () => {
      // The server.address() returns the actual port bound (handles port === 0 case)
      const addr = server.address();
      logger.info(`TCP server listening on port ${addr.port} for websocketPort ${websocketPort}`);
      resolve(server);
    });
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
  return new Promise((resolve) => {
    const socket = new net.Socket();
    
    socket.setTimeout(500);
    
    socket.on('connect', () => {
      // Connected to existing server - destroy it and try to take over
      socket.destroy();
      
      // Now try to bind to the port - this should cause the OS to close the old server
      const takeover = net.createServer();
      takeover.on('error', (err) => {
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
        logger.warn(`Port ${port} in use (attempt ${attempt}/${maxRetries}), attempting to force close...`);
        
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

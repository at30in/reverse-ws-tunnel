const net = require('net');
const cookie = require('cookie');
const { v4: uuidv4 } = require('uuid');
const { HTTPParser, methods } = require('http-parser-js');
const state = require('./state');
const { MESSAGE_TYPE_DATA } = require('./constants');
const { logger } = require('../utils/logger');

function startTCPServer(port, tunnelIdHeaderName, websocketPort) {
  const wsPortKey = String(websocketPort);
  const tcpPortKey = String(port);

  const server = net.createServer((socket) => {
    const uuid = uuidv4();
    const uuidBuffer = Buffer.from(uuid);
    let currentTunnelId = null;
    let isWebSocket = false;

    logger.debug(`New TCP connection on port ${port} with uuid ${uuid}`);

    function createParser() {
      const parser = new HTTPParser(HTTPParser.REQUEST);

      parser[HTTPParser.kOnHeadersComplete] = (info) => {
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

        logger.trace(`Sending initial headers (${rawHeaders.length} bytes) to tunnel [${currentTunnelId}]`);
        tunnel.ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from(rawHeaders)]));

        if (isWebSocket) parser.close();
      };

      parser[HTTPParser.kOnBody] = (chunk, offset, length) => {
        const tunnel = state[wsPortKey]?.websocketTunnels?.[currentTunnelId];
        if (tunnel?.ws && !isWebSocket) {
          const body = chunk.slice(offset, offset + length);
          logger.trace(`Forwarding body (${body.length} bytes) to tunnel [${currentTunnelId}]`);
          tunnel.ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), body]));
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

    socket.on('data', (chunk) => {
      const tunnel = state[wsPortKey]?.websocketTunnels?.[currentTunnelId];
      if (isWebSocket) {
        if (tunnel?.ws) {
          logger.trace(`Forwarding WebSocket TCP data (${chunk.length} bytes) for tunnel [${currentTunnelId}]`);
          tunnel.ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), chunk]));
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
        tunnel.ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from('CLOSE')]));
      }
    });

    socket.on('close', () => {
      const deleted = delete state[wsPortKey]?.websocketTunnels?.[currentTunnelId]?.tcpConnections?.[uuid];
      logger.debug(`TCP socket closed [${uuid}] for tunnel [${currentTunnelId}], connection ${deleted ? 'removed' : 'not found'}`);
    });

    socket.on('error', (err) => {
      logger.error(`Socket error on tunnel [${currentTunnelId}], uuid [${uuid}]:`, err);
      delete state[wsPortKey]?.websocketTunnels?.[currentTunnelId]?.tcpConnections?.[uuid];
    });
  });

  // Store reference
  state[wsPortKey][tcpPortKey].tcpServer = server;

  server.listen(port, () => {
    logger.info(`TCP server listening on port ${port} for websocketPort ${websocketPort}`);
  });

  server.on('error', (err) => {
    logger.error(`TCP server error on port ${port}:`, err);
  });
}

module.exports = { startTCPServer };

const net = require('net');
const cookie = require('cookie');
const { v4: uuidv4 } = require('uuid');
const { HTTPParser, methods } = require('http-parser-js');
const state = require('./state');
const { MESSAGE_TYPE_DATA } = require('./constants');

/**
 * Starts the TCP+HTTP+WebSocket-over-TCP server.
 * @param {number} port - Port to listen on.
 */
function startTCPServer(port, tunnelIdHeaderName, websocketPort) {
  state[String(websocketPort)][String(port)].tcpServer = net.createServer((socket) => {
    const uuid = uuidv4();
    const uuidBuffer = Buffer.from(uuid);
    let currentTunnelId = null;
    let isWebSocket = false;

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

        const tunnel = state[String(websocketPort)].websocketTunnels[currentTunnelId];
        if (!tunnel?.ws) {
          console.error('Invalid or missing tunnel:', currentTunnelId);
          socket.destroy();
          return;
        }

        if (!tunnel.tcpConnections[uuid]) {
          tunnel.tcpConnections[uuid] = { socket };
        }

        const rawHeaders =
          `${methodName} ${info.url} HTTP/${info.versionMajor}.${info.versionMinor}\r\n` +
          info.headers
            .map((v, i) => (i % 2 === 0 ? `${v}: ${info.headers[i + 1]}` : null))
            .filter(Boolean)
            .join('\r\n') +
          '\r\n\r\n';

        isWebSocket = headers['upgrade']?.toLowerCase() === 'websocket';
        tunnel.ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from(rawHeaders)]));
        if (isWebSocket) parser.close();
      };

      parser[HTTPParser.kOnBody] = (chunk, offset, length) => {
        const tunnel = state[String(websocketPort)].websocketTunnels[currentTunnelId];
        if (tunnel?.ws && !isWebSocket) {
          tunnel.ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), chunk.slice(offset, offset + length)]));
        }
      };

      parser[HTTPParser.kOnMessageComplete] = () => {
        if (!isWebSocket) currentParser = createParser();
      };

      return parser;
    }

    let currentParser = createParser();

    socket.on('data', (chunk) => {
      const tunnel = state[String(websocketPort)].websocketTunnels[currentTunnelId];
      if (isWebSocket) {
        if (tunnel?.ws) {
          tunnel.ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), chunk]));
        }
      } else {
        try {
          currentParser.execute(chunk);
        } catch (err) {
          console.error('HTTP parse error:', err);
          socket.destroy();
        }
      }
    });

    socket.on('end', () => {
      const tunnel = state[String(websocketPort)].websocketTunnels[currentTunnelId];
      if (tunnel?.ws) {
        tunnel.ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from('CLOSE')]));
      }
    });

    socket.on('close', () => {
      delete state[String(websocketPort)].websocketTunnels[currentTunnelId]?.tcpConnections[uuid];
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err);
      delete state[String(websocketPort)].websocketTunnels[currentTunnelId]?.tcpConnections[uuid];
    });
  });

  state[String(websocketPort)][String(port)].tcpServer.listen(port, () => {
    console.log(`TCP server listening on port ${port}`);
  });

  state[String(websocketPort)][String(port)].tcpServer.on('error', (err) => {
    console.error('TCP server error:', err);
  });
}

module.exports = { startTCPServer };

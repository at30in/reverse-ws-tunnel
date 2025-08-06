const WebSocket = require('ws');
const { Buffer } = require('buffer');
const state = require('./state');
const { handleParsedMessage } = require('./messageHandler');
const { PING_INTERVAL, MESSAGE_TYPE_CONFIG } = require('./constants');

/**
 * Starts the WebSocket tunnel server.
 * @param {number} port - Port to listen on.
 */
function startWebSocketServer({ port, host, path }) {
  state.webSocketServer = new WebSocket.Server({ port, host, path });

  state.webSocketServer.on('listening', () => {
    console.log(`WebSocket server listening on port ${port}`);
  });

  state.webSocketServer.on('connection', (ws) => {
    let tunnelId = null;
    let buffer = Buffer.alloc(0);

    console.log(`WebSocket connection established`);

    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, PING_INTERVAL);

    ws.on('message', (chunk) => {
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

        handleParsedMessage(ws, tunnelId, uuid, type, payload);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      if (tunnelId) delete state.websocketTunnels[tunnelId];
      clearInterval(interval);
    });

    ws.on('pong', () => console.log('Pong received from client'));

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      clearInterval(interval);
    });
  });

  state.webSocketServer.on('error', (err) => {
    console.error('WebSocket server error:', err);
  });

  return state.webSocketServer;
}

module.exports = { startWebSocketServer };

const state = require('./state');
const { MESSAGE_TYPE_CONFIG, MESSAGE_TYPE_DATA } = require('./constants');

/**
 * Handles a parsed WebSocket message.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {string} tunnelId - Tunnel identifier.
 * @param {string} uuid - Unique identifier for TCP connection.
 * @param {number} type - Message type (config or data).
 * @param {Buffer} payload - Data payload.
 */
function handleParsedMessage(ws, tunnelId, uuid, type, payload) {
  if (type === MESSAGE_TYPE_CONFIG) {
    const config = JSON.parse(payload);
    console.log('Tunnel config received:', config);

    state.websocketTunnels[tunnelId] = {
      ws,
      tcpConnections: {},
      httpConnections: {},
    };

    console.log(`Tunnel [${tunnelId}] established`);
    return;
  }

  const tunnel = state.websocketTunnels[tunnelId];
  if (tunnel?.tcpConnections?.[uuid]?.socket) {
    tunnel.tcpConnections[uuid].socket.write(payload);
  }
}

module.exports = { handleParsedMessage };

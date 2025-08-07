const state = require('./state');
const { MESSAGE_TYPE_CONFIG, MESSAGE_TYPE_DATA } = require('./constants');
const { startTCPServer } = require('./tcpServer');

/**
 * Handles a parsed WebSocket message.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {string} tunnelId - Tunnel identifier.
 * @param {string} uuid - Unique identifier for TCP connection.
 * @param {number} type - Message type (config or data).
 * @param {Buffer} payload - Data payload.
 */
function handleParsedMessage(ws, tunnelId, uuid, type, payload, headerTunnelIdName, port) {
  if (type === MESSAGE_TYPE_CONFIG) {
    try {
      const config = JSON.parse(payload);
      console.log('Tunnel config received:', config);

      const { TUNNEL_ENTRY_PORT } = config;

      if (!TUNNEL_ENTRY_PORT) {
        throw new Error('Missing tunnel entry port!');
      }

      console.log(TUNNEL_ENTRY_PORT);

      console.log(state[port].websocketTunnels);

      state[port].websocketTunnels[tunnelId] = {
        ws,
        tcpConnections: {},
        httpConnections: {},
      };

      if (!state[port][String(TUNNEL_ENTRY_PORT)]) {
        state[port][String(TUNNEL_ENTRY_PORT)] = {};
        state[port][String(TUNNEL_ENTRY_PORT)].tcpServer = startTCPServer(TUNNEL_ENTRY_PORT, headerTunnelIdName, port);
      }

      console.log(`Tunnel [${tunnelId}] established`);
    } catch (error) {
      console.log(error);
    }

    return;
  }

  const tunnel = state[port].websocketTunnels[tunnelId];
  if (tunnel?.tcpConnections?.[uuid]?.socket) {
    tunnel.tcpConnections[uuid].socket.write(payload);
  }
}

module.exports = { handleParsedMessage };

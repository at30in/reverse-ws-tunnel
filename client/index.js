const { startHttpProxyServer } = require('./proxyServer');
const { connectWebSocket } = require('./tunnelClient');

module.exports = {
  startHttpProxyServer,
  connectWebSocket,
};

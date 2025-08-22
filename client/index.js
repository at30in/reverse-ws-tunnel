const { startHttpProxyServer } = require('./proxyServer');
const { connectWebSocket } = require('./tunnelClient');

function startClient({ targetUrl, allowInsicureCerts, wsUrl, tunnelId, tunnelEntryUrl, tunnelEntryPort, headers }) {
  const TARGET_PORT = startHttpProxyServer(targetUrl, allowInsicureCerts);
  connectWebSocket({
    wsUrl,
    tunnelId,
    targetUrl,
    targetPort: TARGET_PORT,
    tunnelEntryUrl,
    tunnelEntryPort,
    headers,
  });
}

module.exports = {
  startClient,
};

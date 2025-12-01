const { startHttpProxyServer } = require('./proxyServer');
const { connectWebSocket } = require('./tunnelClient');

function startClient({ targetUrl, allowInsicureCerts, wsUrl, tunnelId, tunnelEntryUrl, tunnelEntryPort, headers, environment }) {
  environment = environment || 'production';
  const proxy = startHttpProxyServer(targetUrl, allowInsicureCerts);
  const TARGET_PORT = proxy.port;

  const client = connectWebSocket({
    wsUrl,
    tunnelId,
    targetUrl,
    targetPort: TARGET_PORT,
    tunnelEntryUrl,
    tunnelEntryPort,
    headers,
    environment,
  });

  const originalClose = client.close;
  client.close = () => {
    originalClose.call(client);
    proxy.close();
  };

  return client;
}

module.exports = {
  startClient,
};

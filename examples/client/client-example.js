require('dotenv').config();
const { startClient } = require('reverse-ws-tunnel/client');
const { loadConfig } = require('reverse-ws-tunnel/utils');

const config = loadConfig();

startClient({
  targetUrl: config.targetUrl,
  allowInsicureCerts: config.allowInsicureCerts,
  wsUrl: config.wsUrl,
  tunnelId: config.tunnelId,
  tunnelEntryUrl: config.tunnelEntryUrl,
  tunnelEntryPort: Number(config.tunnelEntryPort),
  headers: config.headers,
  environment: config.environment,
});

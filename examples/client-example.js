require('dotenv').config();
const { startClient } = require('reverse-ws-tunnel/client');
// const { initLogger } = require('../utils/logger');

// initLogger({
//   configPath: './examples/log.config.json',
// });

const { TUNNEL_ID, WS_URL, TARGET_URL, TUNNEL_ENTRY_URL, TUNNEL_ENTRY_PORT, HEADERS } = process.env;
const ALLOW_INSICURE_CERTS = process.env.ALLOW_INSICURE_CERTS === 'true';

// const TARGET_PORT = startHttpProxyServer(TARGET_URL, ALLOW_INSICURE_CERTS);
startClient({
  targetUrl: TARGET_URL,
  allowInsicuereCerts: ALLOW_INSICURE_CERTS,
  wsUrl: WS_URL,
  tunnelId: TUNNEL_ID,
  tunnelEntryUrl: TUNNEL_ENTRY_URL,
  tunnelEntryPort: Number(TUNNEL_ENTRY_PORT),
  headers: HEADERS,
});

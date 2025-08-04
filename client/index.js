require('dotenv').config();
const { startHttpProxyServer } = require('./proxyServer');
const { connectWebSocket } = require('./tunnelClient');

const { TUNNEL_ID, WS_URL, TARGET_URL, TUNNEL_ENTRY_URL, TUNNEL_ENTRY_PORT, JWT_TOKEN } = process.env;

const TARGET_PORT = startHttpProxyServer(TARGET_URL);

connectWebSocket({
  wsUrl: WS_URL,
  jwt: JWT_TOKEN,
  tunnelId: TUNNEL_ID,
  targetUrl: TARGET_URL,
  targetPort: TARGET_PORT,
  tunnelEntryUrl: TUNNEL_ENTRY_URL,
  tunnelEntryPort: Number(TUNNEL_ENTRY_PORT),
});

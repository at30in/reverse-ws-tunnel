require('dotenv').config();
const { startHttpProxyServer } = require('./proxyServer');
const { connectWebSocket } = require('./tunnelClient');

const { TUNNEL_ID, WS_URL, TARGET_URL, TUNNEL_ENTRY_URL, TUNNEL_ENTRY_PORT, HEADERS } = process.env;
const ALLOW_INSICURE_CERTS = process.env.ALLOW_INSICURE_CERTS === 'true';

const TARGET_PORT = startHttpProxyServer(TARGET_URL, ALLOW_INSICURE_CERTS);

connectWebSocket({
  wsUrl: WS_URL,
  tunnelId: TUNNEL_ID,
  targetUrl: TARGET_URL,
  targetPort: TARGET_PORT,
  tunnelEntryUrl: TUNNEL_ENTRY_URL,
  tunnelEntryPort: Number(TUNNEL_ENTRY_PORT),
  headers: HEADERS,
});

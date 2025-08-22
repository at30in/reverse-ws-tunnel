require('dotenv').config();
const { startClient } = require('reverse-ws-tunnel/client');
// const { setLogLevel, getLogLevel } = require('reverse-ws-tunnel/utils');

// setLogLevel('debug')

const { TUNNEL_ID, WS_URL, TARGET_URL, TUNNEL_ENTRY_URL, TUNNEL_ENTRY_PORT, HEADERS } = process.env;
const ALLOW_INSICURE_CERTS = process.env.ALLOW_INSICURE_CERTS === 'true';

startClient({
  targetUrl: TARGET_URL,
  allowInsicuereCerts: ALLOW_INSICURE_CERTS,
  wsUrl: WS_URL,
  tunnelId: TUNNEL_ID,
  tunnelEntryUrl: TUNNEL_ENTRY_URL,
  tunnelEntryPort: Number(TUNNEL_ENTRY_PORT),
  headers: HEADERS,
});

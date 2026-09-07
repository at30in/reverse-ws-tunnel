require('dotenv').config();
const { startWebSocketServer, sendCommand, setLogContext } = require('@remotelinker/reverse-ws-tunnel/server');
const { createHttpApi } = require('@remotelinker/reverse-ws-tunnel/server/httpApi');
const { loadConfig, getMetrics } = require('@remotelinker/reverse-ws-tunnel/utils');
// const { setLogLevel, getLogLevel } = require('@remotelinker/reverse-ws-tunnel/utils');

const config = loadConfig();

// setLogLevel('error');
setLogContext('SERVER');

const wsPort = parseInt(process.env.WS_PORT || '443', 10);
const apiPort = parseInt(process.env.API_PORT || '3001', 10);
const tunnelIdHeaderName = process.env.TUNNEL_ID_HEADER_NAME || 'x-tunnel-id';
const host = process.env.HOST;
const path = process.env.PATH_URL;

startWebSocketServer({ port: wsPort, host, path, tunnelIdHeaderName });

// Start HTTP API server for remote commands
createHttpApi(wsPort, apiPort);

// Log metrics every 30 seconds at debug level
getMetrics().startSummaryTimer(30000);

// Example: send kill command via HTTP API after 15 seconds
// Try it: curl -X POST http://localhost:3001/api/tunnel/command -H "Content-Type: application/json" -d '{"tunnelId":"1cf2755f-c151-4281-b3f0-55c399035f87","command":"kill","args":{"signal":"SIGTERM"}}'
setTimeout(() => {
  const tunnelId = config.tunnelId || '1cf2755f-c151-4281-b3f0-55c399035f87';
  console.log(`[DEMO] Sending kill command to tunnel ${tunnelId}...`);
  const sent = sendCommand(wsPort, tunnelId, 'kill', { signal: 'SIGTERM' });
  console.log(`[DEMO] Kill command sent: ${sent}`);
}, 15000);

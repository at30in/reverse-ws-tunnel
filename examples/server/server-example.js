require('dotenv').config();
const { startWebSocketServer, setLogContext } = require('@remotelinker/reverse-ws-tunnel/server');
const { loadConfig, getMetrics } = require('@remotelinker/reverse-ws-tunnel/utils');
// const { setLogLevel, getLogLevel } = require('@remotelinker/reverse-ws-tunnel/utils');

const config = loadConfig();

// setLogLevel('error');
setLogContext('SERVER');

const wsPort = parseInt(process.env.WS_PORT || '443', 10);
const tunnelIdHeaderName = process.env.TUNNEL_ID_HEADER_NAME || 'x-tunnel-id';
const host = process.env.HOST;
const path = process.env.PATH_URL;

startWebSocketServer({ port: wsPort, host, path, tunnelIdHeaderName });

// Log metrics every 30 seconds at debug level
getMetrics().startSummaryTimer(30000);

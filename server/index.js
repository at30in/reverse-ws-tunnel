require('dotenv').config();
const { startWebSocketServer } = require('./websocketServer');
// const { startTCPServer } = require('./tcpServer');

const wsPort = parseInt(process.env.WS_PORT || '4443', 10);
const tunnelIdHeaderName = process.env.TUNNEL_ID_HEADER_NAME || 'x-tunnel-id';
const host = process.env.HOST;
const path = process.env.PATH_URL;
// const tcpPort = parseInt(process.env.TUNNEL_ENTRY_PORT || '8083', 10);

startWebSocketServer({ port: wsPort, host, path, tunnelIdHeaderName });
// startTCPServer(tcpPort);

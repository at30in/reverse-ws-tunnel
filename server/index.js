require('dotenv').config();
const { startWebSocketServer } = require('./websocketServer');
const { startTCPServer } = require('./tcpServer');

const wsPort = parseInt(process.env.WS_PORT || '4443', 10);
const tcpPort = parseInt(process.env.TUNNEL_ENTRY_PORT || '8083', 10);

startWebSocketServer(wsPort);
startTCPServer(tcpPort);

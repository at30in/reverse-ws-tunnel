import 'dotenv/config';
import { startWebSocketServer, sendCommand, setLogContext } from '../../server/index.mjs';
import { createHttpApi } from '../../server/index.mjs';
import { loadConfig } from '../../utils/index.mjs';

setLogContext('SERVER');

const wsPort = parseInt(process.env.WS_PORT || '443', 10);
const apiPort = parseInt(process.env.API_PORT || '3001', 10);
const tunnelIdHeaderName = process.env.TUNNEL_ID_HEADER_NAME || 'x-tunnel-id';
const host = process.env.HOST;
const path = process.env.PATH_URL;

startWebSocketServer({ port: wsPort, host, path, tunnelIdHeaderName });

// Start HTTP API server for remote commands
createHttpApi(wsPort, apiPort);

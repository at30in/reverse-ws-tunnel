import 'dotenv/config';
import { startWebSocketServer, setLogContext } from '../../server/index.mjs';
import { loadConfig, setLogLevel } from '../../utils/index.mjs';

setLogLevel('error');
setLogContext('SERVER');

const wsPort = parseInt(process.env.WS_PORT || '443', 10);
const tunnelIdHeaderName = process.env.TUNNEL_ID_HEADER_NAME || 'x-tunnel-id';
const host = process.env.HOST;
const path = process.env.PATH_URL;

startWebSocketServer({ port: wsPort, host, path, tunnelIdHeaderName });

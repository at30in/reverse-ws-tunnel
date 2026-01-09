// examples/typescript/server-example.ts
import { startWebSocketServer, setLogContext } from '../../server/index.mjs';
import { loadConfig } from '../../utils/index.mjs';

setLogContext('SERVER');

const wsPort: number = parseInt(process.env.WS_PORT || '443', 10);
const tunnelIdHeaderName: string = process.env.TUNNEL_ID_HEADER_NAME || 'x-tunnel-id';
const host: string | undefined = process.env.HOST;
const path: string | undefined = process.env.PATH_URL;

startWebSocketServer({
  port: wsPort,
  host,
  path,
  tunnelIdHeaderName
});

console.log(`WebSocket tunnel server started on port ${wsPort}`);
require('dotenv').config();
const WebSocket = require('ws');
const net = require('net');
const { Buffer } = require('buffer');
const { v4: uuidv4 } = require('uuid');
const httpProxy = require('http-proxy');
const http = require('http');

const RECONNECT_INTERVAL = 5000;
const TUNNEL_PORT = 1237;

const MESSAGE_TYPE_CONFIG = 0x01;
const MESSAGE_TYPE_DATA = 0x02;

const { TUNNEL_ID, WS_URL, TARGET_URL, TUNNEL_ENTRY_URL, TUNNEL_ENTRY_PORT, JWT_TOKEN } = process.env;

const clients = {};

/**
 * Starts a transparent HTTP and WebSocket proxy server that forwards to TARGET_URL.
 * @returns {number} - The port the proxy server is listening on.
 */
function startHttpProxyServer() {
  const proxy = httpProxy.createProxyServer({});
  const server = http.createServer((req, res) => {
    console.log(`Proxying request: ${req.method} ${req.url}`);

    if (!TARGET_URL) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing TARGET_URL');
    }

    proxy.web(req, res, { target: TARGET_URL, changeOrigin: true, secure: true }, (err) => {
      console.error('Proxy error:', err);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad gateway');
      } else {
        res.end();
      }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    console.log(`Proxying WebSocket request: ${req.url}`);
    proxy.ws(req, socket, head, { target: TARGET_URL, changeOrigin: false, secure: false });
  });

  proxy.on('error', (err, req, res) => {
    console.error('Proxy error:', err);
    if (res && !res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Proxy error');
    }
  });

  server.listen(0, () => {
    console.log(`HTTP proxy server started on port ${server.address().port}`);
  });

  return server.address().port;
}

/**
 * Validates required environment variables.
 * Throws an error if any variable is invalid.
 */
function validateEnvVariables() {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(TUNNEL_ID)) {
    throw new Error('TUNNEL_ID must be a valid UUIDv4.');
  }

  const wsUrl = new URL(WS_URL);
  if (!['ws:', 'wss:'].includes(wsUrl.protocol)) {
    throw new Error('WS_URL must be a valid WebSocket URL (ws:// or wss://)');
  }

  new URL(TARGET_URL); // Throws if invalid
}

// Initialization
validateEnvVariables();
const TARGET_PORT = startHttpProxyServer();

/**
 * Connects to the WebSocket tunnel server and handles incoming/outgoing messages.
 */
function connectWebSocket() {
  const ws = new WebSocket(WS_URL, {
    headers: {
      Authorization: `Bearer ${JWT_TOKEN}`,
      'x-websocket-tunnel-port': TUNNEL_PORT,
    },
  });

  ws.on('open', () => {
    console.log('Connected to WebSocket tunnel server');

    const uuid = uuidv4();
    const payload = {
      TARGET_URL,
      TARGET_PORT,
      TUNNEL_ENTRY_URL,
      TUNNEL_ENTRY_PORT,
      environment: 'production',
      agentVersion: '1.0.0',
      additionalInfo: {
        company: 'Acme Corp',
        location: 'Data Center 1',
      },
    };

    const messageBuffer = buildMessageBuffer(TUNNEL_ID, uuid, MESSAGE_TYPE_CONFIG, JSON.stringify(payload));
    ws.send(messageBuffer);
    console.log('Sent config to server');
  });

  ws.on('message', async (data) => {
    const uuid = data.slice(0, 36).toString();
    const type = data.readUInt8(36);
    const payload = data.slice(37);

    if (type === MESSAGE_TYPE_DATA) {
      if (payload.toString() === 'CLOSE') {
        clients[uuid]?.end();
        return;
      }

      const client = clients[uuid] || createClientTCP(ws, uuid);
      if (!client.write(payload)) {
        client.once('drain', () => console.log(`Drain complete for ${uuid}`));
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  ws.on('close', () => {
    console.log('WebSocket disconnected. Cleaning up.');
    for (const uuid in clients) {
      try {
        clients[uuid].end();
        clients[uuid].destroy();
        delete clients[uuid];
      } catch (err) {
        console.error(`Error closing TCP client ${uuid}:`, err);
      }
    }
    setTimeout(connectWebSocket, RECONNECT_INTERVAL);
  });

  setInterval(() => {
    console.log('[Active Clients]', Object.keys(clients));
  }, 5000);
}

/**
 * Creates a TCP client connection to the local target service.
 * @param {WebSocket} ws - Active WebSocket connection to the tunnel server
 * @param {string} uuid - Unique identifier for this tunnel session
 * @returns {net.Socket} - The TCP socket
 */
function createClientTCP(ws, uuid) {
  const client = net.createConnection(TARGET_PORT, new URL(TARGET_URL).hostname);
  clients[uuid] = client;

  client.on('data', (data) => {
    const message = buildMessageBuffer(TUNNEL_ID, uuid, MESSAGE_TYPE_DATA, data);
    ws.send(message);
  });

  client.on('error', (err) => {
    console.error(`TCP error for ${uuid}:`, err);
    client.destroy();
    delete clients[uuid];
  });

  client.on('end', () => {
    console.log(`TCP connection closed for ${uuid}`);
    delete clients[uuid];
  });

  return client;
}

/**
 * Builds a binary message buffer to send through the WebSocket tunnel.
 * @param {string} tunnelId - Global tunnel ID
 * @param {string} uuid - Per-connection UUID
 * @param {number} type - Message type code
 * @param {string|Buffer} payload - The payload data
 * @returns {Buffer} - The full message buffer
 */
function buildMessageBuffer(tunnelId, uuid, type, payload) {
  const uuidTunnelBuffer = Buffer.from(tunnelId);
  const uuidBuffer = Buffer.from(uuid);
  const typeBuffer = Buffer.from([type]);
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');

  const totalLength = uuidTunnelBuffer.length + uuidBuffer.length + typeBuffer.length + payloadBuffer.length;
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(totalLength);

  return Buffer.concat([lengthBuffer, uuidTunnelBuffer, uuidBuffer, typeBuffer, payloadBuffer]);
}

// Start tunnel client
connectWebSocket();

const WebSocket = require('ws');
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const { buildMessageBuffer } = require('./utils');

const RECONNECT_INTERVAL = 5000;
const MESSAGE_TYPE_CONFIG = 0x01;
const MESSAGE_TYPE_DATA = 0x02;
const clients = {};

/**
 * Starts the WebSocket tunnel client.
 * @param {Object} config - Configuration for tunnel.
 * @param {string} config.wsUrl
 * @param {string} config.jwt
 * @param {string} config.tunnelId
 * @param {string} config.targetUrl
 * @param {number} config.targetPort
 * @param {string} config.tunnelEntryUrl
 * @param {number} config.tunnelEntryPort
 */
function connectWebSocket(config) {
  const { wsUrl, jwt, tunnelId, targetUrl, targetPort, tunnelEntryUrl, tunnelEntryPort } = config;

  const ws = new WebSocket(wsUrl, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'x-websocket-tunnel-port': targetPort,
    },
  });

  ws.on('open', () => {
    console.log('Connected to WebSocket server');

    const uuid = uuidv4();
    const payload = {
      TARGET_URL: targetUrl,
      TARGET_PORT: targetPort,
      TUNNEL_ENTRY_URL: tunnelEntryUrl,
      TUNNEL_ENTRY_PORT: tunnelEntryPort,
      environment: 'production',
      agentVersion: '1.0.0',
    };

    const message = buildMessageBuffer(tunnelId, uuid, MESSAGE_TYPE_CONFIG, JSON.stringify(payload));
    ws.send(message);
  });

  ws.on('message', (data) => {
    const uuid = data.slice(0, 36).toString();
    const type = data.readUInt8(36);
    const payload = data.slice(37);

    if (type === MESSAGE_TYPE_DATA) {
      if (payload.toString() === 'CLOSE') {
        clients[uuid]?.end();
        return;
      }

      const client = clients[uuid] || createTcpClient(targetUrl, targetPort, ws, tunnelId, uuid);
      if (!client.write(payload)) {
        client.once('drain', () => console.log(`Drain complete for ${uuid}`));
      }
    }
  });

  ws.on('close', () => {
    console.log('WebSocket disconnected, cleaning up.');
    for (const uuid in clients) {
      clients[uuid].end();
      clients[uuid].destroy();
      delete clients[uuid];
    }
    setTimeout(() => connectWebSocket(config), RECONNECT_INTERVAL);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
}

/**
 * Creates a TCP connection to the target service.
 */
function createTcpClient(targetUrl, targetPort, ws, tunnelId, uuid) {
  const client = net.createConnection(targetPort, new URL(targetUrl).hostname);
  clients[uuid] = client;

  client.on('data', (data) => {
    const message = buildMessageBuffer(tunnelId, uuid, MESSAGE_TYPE_DATA, data);
    ws.send(message);
  });

  client.on('error', (err) => {
    console.error(`TCP error [${uuid}]:`, err);
    client.destroy();
    delete clients[uuid];
  });

  client.on('end', () => {
    console.log(`TCP connection closed for ${uuid}`);
    delete clients[uuid];
  });

  return client;
}

module.exports = {
  connectWebSocket,
};

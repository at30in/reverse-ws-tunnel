const WebSocket = require('ws');
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const { buildMessageBuffer } = require('./utils');

const RECONNECT_INTERVAL = 5000;
const MESSAGE_TYPE_CONFIG = 0x01;
const MESSAGE_TYPE_DATA = 0x02;
const clients = {};
const PING_INTERVAL = 30 * 1000; //30s
const PONG_WAIT = 5 * 1000; //5s

/**
 * Starts the WebSocket tunnel client.
 * @param {Object} config - Configuration for tunnel.
 * @param {string} config.wsUrl
 * @param {string} config.tunnelId
 * @param {string} config.targetUrl
 * @param {number} config.targetPort
 * @param {string} config.tunnelEntryUrl
 * @param {number} config.tunnelEntryPort
 */
function connectWebSocket(config) {
  const { wsUrl, tunnelId, targetUrl, targetPort, tunnelEntryUrl, tunnelEntryPort, headers } = config;
  let ws;
  let pingInterval;

  try {
    let headersParsed = JSON.parse(headers || '{}');
    ws = new WebSocket(wsUrl, {
      headers: headersParsed,
    });
  } catch (error) {
    console.error('Malformed headers:', error);
  }

  ws.on('open', () => {
    console.log('Connected to WebSocket server');

    ({ pingInterval } = heartBeat(ws));

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
    clearInterval(pingInterval);
    // clearTimeout(pongTimeout);
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

function heartBeat(ws) {
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();

      const pongTimeout = setTimeout(() => {
        console.warn('Timeout: no pong received, closing the connection');
        ws.terminate(); // forza la chiusura della connessione
      }, PONG_WAIT);

      ws.once('pong', () => {
        clearTimeout(pongTimeout);
      });
    }
  }, PING_INTERVAL);

  return { pingInterval };
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

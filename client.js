require('dotenv').config();
const WebSocket = require('ws');
const net = require('net');
const Buffer = require('buffer').Buffer;
const { v4: uuidv4 } = require('uuid');
const httpProxy = require('http-proxy');
const http = require('http');

const RECONNECT_INTERVAL = 1000 * 5;

// Tipo di messaggio (1 byte)
const MESSAGE_TYPE_CONFIG = 0x01;
const MESSAGE_TYPE_DATA = 0x02;

const TUNNEL_ID = process.env.TUNNEL_ID;
const WS_URL = process.env.WS_URL;
const TARGET_URL = process.env.TARGET_URL;
const TUNNEL_ENTRY_URL = process.env.TUNNEL_ENTRY_URL;
const TUNNEL_ENTRY_PORT = process.env.TUNNEL_ENTRY_PORT;
const JWT_TOKEN = process.env.JWT_TOKEN;
const tunnelPort = 1237;

// Opzioni per la connessione WebSocket
const options = {
  headers: {
    Authorization: `Bearer ${JWT_TOKEN}`,
    'x-websocket-tunnel-port': tunnelPort,
  },
};
const clients = {};

// ----------- HTTP Proxy
function httpProxyServer() {
  // Crea un proxy server
  const proxy = httpProxy.createProxyServer({});

  // Crea un server HTTP
  const server = http.createServer((req, res) => {
    console.log(`Proxying request: ${req.method} ${req.url}`);

    console.log(TARGET_URL);

    if (!TARGET_URL) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing "x-target-url" header');
    }

    proxy.on('proxyReq', (proxyReq, req, res, options) => {
      console.log('ProxyReq Host header:', proxyReq.getHeader('host'));
    });

    // Inoltra la richiesta
    proxy.web(req, res, { target: TARGET_URL, changeOrigin: true, secure: true }, (e) => {
      console.error('Proxy error:', e);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad gateway');
      } else {
        // Headers già inviati, chiudi la risposta in modo "pulito"
        res.end();
      }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    console.log(`Proxying WebSocket request: ${req.url}`);
    proxy.ws(req, socket, head, { target: TARGET_URL, changeOrigin: false, secure: false });
  });

  // WebSocket error
  proxy.on('error', (err, req, res) => {
    console.error('Proxy error:', err);
    if (res && !res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Proxy error');
    }
  });

  // Avvia il server su una porta qualsiasi
  // server.listen(8080, () => {
  server.listen(0, () => {
    console.log(`Transparent HTTP proxy listening on port ${server.address().port}`);
  });

  return server.address().port;
}

const TARGET_PORT = httpProxyServer();

function validateEnvVaribles() {
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidV4Regex.test(TUNNEL_ID)) {
    throw new Error('Invalid UUID format: TUNNEL_ID must be a valid UUIDv4.');
  }

  try {
    const parsedUrl = new URL(WS_URL);

    if (parsedUrl.protocol !== 'ws:' && parsedUrl.protocol !== 'wss:') {
      throw new Error();
    }

    // console.log('WebSocket URL is valid:', WS_URL);
  } catch (err) {
    throw new Error('Invalid WebSocket URL: WS_URL must be a valid ws:// or wss:// URL.');
  }

  try {
    const parsedUrl = new URL(TARGET_URL);

    console.log(parsedUrl.href);

    // console.log('Valid endpoint URL:', TARGET_URL);
  } catch (err) {
    throw new Error('Invalid URL: TARGET_URL must be a valid URL.');
  }
}
validateEnvVaribles();

function connectWebSocket() {
  // Crea una connessione al server WebSocket
  const ws = new WebSocket(WS_URL, options);

  setInterval(() => {
    console.log('-----[Clients]----');
    console.log(Object.keys(clients));
    console.log('-----[/Clients]----');
  }, 5000);

  // Quando la connessione è aperta, invia un messaggio al server
  ws.on('open', () => {
    console.log('Connected to the WebSocket server');

    // UUID
    const uuid = uuidv4(); // es: '123e4567-e89b-12d3-a456-426614174000'

    // Payload JSON
    const payloadObject = {
      TARGET_URL,
      TARGET_PORT,
      TUNNEL_ENTRY_URL,
      TUNNEL_ENTRY_PORT,
      environment: 'production',
      agentVersion: '1.0.0',
      // TUNNEL_ID,
      additionalInfo: {
        company: 'Acme Corp',
        location: 'Data Center 1',
      },
    };

    const uuidTunnelBuffer = Buffer.from(TUNNEL_ID);
    const uuidBuffer = Buffer.from(uuid);
    const typeBuffer = Buffer.from([MESSAGE_TYPE_CONFIG]);
    const payloadBuffer = Buffer.from(JSON.stringify(payloadObject), 'utf8');

    const totalLength = uuidTunnelBuffer.length + uuidBuffer.length + typeBuffer.length + payloadBuffer.length;
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(totalLength);

    const messageBuffer = Buffer.concat([lengthBuffer, uuidTunnelBuffer, uuidBuffer, typeBuffer, payloadBuffer]);
    ws.send(messageBuffer);

    console.log('Sent: ', messageBuffer);
  });

  // Quando ricevi un messaggio dal server, stampalo
  ws.on('message', async (data) => {
    console.log('Received from server: ', data);

    const uuid = data.slice(0, 36);
    const type = data.readUInt8(36);
    console.log(`Received from server type message ${type}`);
    data = data.slice(37);

    clients[uuid] = clientTCP(ws, uuid);

    // client = clientTCP(client, ws);

    if (data == 'CLOSE') {
      clients[uuid].end();
      // clients[uuid] = clientTCP(ws, uuid);
      return;
    }

    if (!clients[uuid].write(data)) {
      clients[uuid].once('drain', () => {
        console.log(`Drained, ready to send more data for ${uuid}`);
      });
    }
    try {
    } catch (error) {
      console.log('------ERR-----');
      console.log(error);
      console.log('------/ERR-----');
    }
  });

  // Gestione degli errori di connessione
  ws.on('error', (error) => {
    console.error('Error occurred: ', error);
  });

  // Quando la connessione è chiusa, stampa un messaggio
  ws.on('close', () => {
    console.log('Disconnected from the WebSocket server');
    // Chiudi tutte le connessioni TCP aperte
    for (const uuid in clients) {
      try {
        clients[uuid].end();
        clients[uuid].destroy(); // extra safe
        delete clients[uuid];
      } catch (e) {
        console.error(`Error closing client ${uuid}:`, e);
      }
    }
    setTimeout(connectWebSocket, RECONNECT_INTERVAL);
  });
}

connectWebSocket();

function clientTCP(ws, uuid) {
  if (clients[uuid] && clients[uuid].writable && clients[uuid].readable) {
    console.log('Client esiste e non è chiuso');
    return clients[uuid];
  }
  if (clients[uuid]) {
    delete clients[uuid];
  }

  clients[uuid] = net.createConnection(TARGET_PORT, new URL(TARGET_URL).hostname);
  let client = clients[uuid];

  // Ricevi i dati dalla risposta del server
  client.on('data', (data) => {
    console.log('DATA FROM SERVER');
    console.log(data);
    console.log('////////');

    const uuidTunnelBuffer = Buffer.from(TUNNEL_ID);
    const uuidBuffer = Buffer.from(uuid);
    const typeBuffer = Buffer.from([MESSAGE_TYPE_DATA]);
    const payloadBuffer = data;

    const totalLength = uuidTunnelBuffer.length + uuidBuffer.length + typeBuffer.length + payloadBuffer.length;
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(totalLength);

    ws.send(Buffer.concat([lengthBuffer, uuidTunnelBuffer, uuidBuffer, typeBuffer, payloadBuffer]));
  });

  client.on('error', (error) => {
    console.log(error);
    client.destroy(); // distrugge anche in caso di errore
    delete clients[uuid];
  });

  // Quando la connessione si chiude
  client.on('end', () => {
    console.log('Connection closed');
    delete clients[uuid];
  });

  return client;
}

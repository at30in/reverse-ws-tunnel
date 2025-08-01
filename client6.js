const WebSocket = require('ws');
const net = require('net');
const Buffer = require('buffer').Buffer;
const tls = require('tls');
const { v4: uuidv4 } = require('uuid');
const httpProxy = require('http-proxy');
const http = require('http');
// const { Writable } = require('stream');

const tunnelPort = 1237;
const RECONNECT_INTERVAL = 1000 * 5;

// Tipo di messaggio (1 byte)
const MESSAGE_TYPE_CONFIG = 0x01;
const MESSAGE_TYPE_DATA = 0x02;

// Indirizzo del server WebSocket a cui ci si vuole connettere
// const serverUrl = 'ws://quality-engine-alb-875143533.eu-west-1.elb.amazonaws.com:4443'; // Cambia questo con l'URL del server a cui vuoi connetterti
const serverUrl = 'ws://localhost:4443'; // Cambia questo con l'URL del server a cui vuoi connetterti

const target = 'http://api.yousolution.internal:1880';

// Token di autenticazione (Bearer Token)
const token = `token-secure-data`; // Sostituisci con il tuo Bearer Token

// Opzioni per la connessione WebSocket
const options = {
  headers: {
    Authorization: `Bearer ${token}`,
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

    if (!target) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing "x-target-url" header');
    }

    proxy.on('proxyReq', (proxyReq, req, res, options) => {
      console.log('ProxyReq Host header:', proxyReq.getHeader('host'));
    });

    // Inoltra la richiesta
    proxy.web(req, res, { target, changeOrigin: true, secure: true }, (e) => {
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
    proxy.ws(req, socket, head, { target, changeOrigin: false, secure: false });
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

const httpProxyServerPort = httpProxyServer();

function connectWebSocket() {
  // Crea una connessione al server WebSocket
  const ws = new WebSocket(serverUrl, options);

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
    const uuidBuffer = Buffer.from(uuid); // 36 byte

    // Payload JSON
    const payloadObject = {
      targetHost: 'localhost',
      targetPort: httpProxyServerPort,
      srcPort: '8083',
      environment: 'production',
      agentVersion: '1.0.0',
      uuidTunnel: '1cf2755f-c151-4281-b3f0-55c399035f89',
      additionalInfo: {
        company: 'Acme Corp',
        location: 'Data Center 1',
      },
    };
    const payloadBuffer = Buffer.from(JSON.stringify(payloadObject), 'utf8');

    // Costruisci messaggio binario
    const messageBuffer = Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_CONFIG]), payloadBuffer]);

    // ws.send(Buffer.concat([Buffer.from( uuidv4()), data]));
    // const message = JSON.stringify({ type: 'greeting', message: 'Hello, Server!' });
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

    // clients[uuid].write(data);

    // Decodifica la stringa Base64
    try {
      // const request = JSON.parse(Buffer.from(data, 'base64').toString('utf-8'));
      // const rawHttpRequest = Buffer.from(request.httpRequest, 'base64').toString('utf-8');
      // console.log('Decoded HTTP RAW Request:', request.httpRequest);
      // const extractedUUID = data.slice(0, 36);
      // console.log(extractedUUID);
      // const res = await incomingRequest(data.slice(36)); // tolgo dal buffer uuid
      // const res = await incomingRequest(data); // tolgo dal buffer uuid
      // console.log('======');
      // console.log(res.toString('utf-8'));
      // console.log('======');
      // ws.send(Buffer.concat([extractedUUID, res]));
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

  // client = net.createConnection(1433, 'localhost');
  // uuid = uuidv4();
  clients[uuid] = net.createConnection(httpProxyServerPort, 'localhost');
  let client = clients[uuid];

  // Ricevi i dati dalla risposta del server
  client.on('data', (data) => {
    console.log('DATA FROM SERVER');
    console.log(data);
    console.log('////////');
    // responseData = Buffer.concat([responseData, data]); // Accumula i dati ricevuti
    // ws.send(Buffer.concat([Buffer.from(uuid), Buffer.from(data)]));
    ws.send(Buffer.concat([Buffer.from(uuid), Buffer.from([MESSAGE_TYPE_DATA]), data]));
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
    // client = clientTCP(ws, uuid);
    // resolve(responseData);
  });

  return client;
}

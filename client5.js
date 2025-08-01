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

// Indirizzo del server WebSocket a cui ci si vuole connettere
const serverUrl = 'ws://localhost:4443'; // Cambia questo con l'URL del server a cui vuoi connetterti

const target = 'http://api.yousolution.internal:1880';

// Token di autenticazione (Bearer Token)
// const token = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9kdWNlckxheWVyb25lIiwic3ViIjoiNjU5ZWFmZTk4YjRkODQwMDExMDM4MWYyIiwicm9sZSI6IldlYlNlcnZpY2UiLCJjb21wYW55IjoiNjU5ZWFmZTk4YjRkODQwMDExMDM4MWYxIiwiaWF0IjoxNzA0ODk4NTM3fQ.X320faLFLZYRB-BJepa7j_GO-6kq1Rz_9F6CtpO-I61ZZ7WI_ALADQfD4NBygsIkV1IzsZOAVvQlmB1Nff-5bg`; // Sostituisci con il tuo Bearer Token
const token = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9kdWNlckxheWVyb25lIiwic3ViIjoiNjU5ZWFmZTk4YjRkODQwMDExMDM4MWYyIiwicm9sZSI6IldlYlNlcnZpY2UiLCJjb21wYW55IjoiNjU5ZWFmZTk4YjRkODQwMDExMDM4MWYxIiwiaWF0IjoxNzA0ODk4NTM3fQ.X320faLFLZYRB-BJepa7j_GO-6kq1Rz_9F6CtpO-I61ZZ7WI_ALADQfD4NBygsIkV1IzsZOAVvQlmB1Nff-5bg`; // Sostituisci con il tuo Bearer Token

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

  // proxy.on('proxyRes', function (proxyRes, req, res) {
  //   res.setHeader('Access-Control-Allow-Origin', 'http://localhost:8083'); // o '*'
  //   res.setHeader('Access-Control-Allow-Credentials', 'true');
  //   res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  //   res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  // });

  // const proxy = httpProxy.createProxyServer({ target: 'https://example.com', changeOrigin: true, secure: false });

  // Crea un server HTTP
  const server = http.createServer((req, res) => {
    console.log(`Proxying request: ${req.method} ${req.url}`);
    // if (req.method === 'OPTIONS') {
    //   res.writeHead(204, {
    //     'Access-Control-Allow-Origin': 'http://localhost:8083', // o '*'
    //     'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    //     'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    //     'Access-Control-Allow-Credentials': 'true',
    //     'Content-Length': '0',
    //   });
    //   return res.end();
    // }

    // // CORS HEADERS
    // if (req.headers.origin) {
    //   res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    // }
    // res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    // res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    // res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Estrai l'host di destinazione dai header o imposta un target fisso
    // const target = req.headers['x-target-url'];
    // const target = 'https://www.google.it';

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

  // client = clientTCP(ws);

  // Creazione di un socket TCP
  // let client = net.createConnection(1433, 'localhost');

  // // Ricevi i dati dalla risposta del server
  // client.on('data', (data) => {
  //   console.log('FROM SQL SERVER');
  //   console.log(data);
  //   console.log('////////');
  //   // responseData = Buffer.concat([responseData, data]); // Accumula i dati ricevuti
  //   ws.send(data);
  // });

  // client.on('error', (error) => {
  //   console.log(error);
  // });

  // // Quando la connessione si chiude
  // client.on('end', () => {
  //   console.log('Connection closed');
  //   // resolve(responseData);
  // });

  // Quando la connessione è aperta, invia un messaggio al server
  ws.on('open', () => {
    console.log('Connected to the WebSocket server');
    const message = JSON.stringify({ type: 'greeting', message: 'Hello, Server!' });
    ws.send(message);
    console.log('Sent: ', message);
  });

  // Quando ricevi un messaggio dal server, stampalo
  ws.on('message', async (data) => {
    console.log('Received from server: ', data);

    const uuid = data.slice(0, 36);
    data = data.slice(36);

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

async function incomingRequest(rawHttpRequest) {
  const { hostname, port } = extractHostAndPort(rawHttpRequest);

  if (port == 443) {
    return await tlsRequest(rawHttpRequest);
  }

  return await tcpRequest(rawHttpRequest);
}

function tlsRequest(rawHttpRequest) {
  return new Promise((resolve, reject) => {
    const { hostname, port } = extractHostAndPort(rawHttpRequest);

    let responseData = Buffer.alloc(0); // Inizializza un buffer vuoto per accumulare i dati

    console.log(hostname);
    console.log(port);
    // Creazione di un socket TCP
    const client = tls.connect(port, hostname, { servername: hostname }, () => {
      client.write(rawHttpRequest); // Invia la richiesta HTTP raw
    });

    // Ricevi i dati dalla risposta del server
    client.on('data', (data) => {
      // console.log('Received response from server:');
      // console.log(data.toString()); // Converte i dati ricevuti in stringa e li stampa
      // return resolve(data);
      responseData = Buffer.concat([responseData, data]); // Accumula i dati ricevuti
    });

    // Quando la connessione si chiude
    client.on('end', () => {
      console.log('Connection closed');
      resolve(responseData);
      // client.destroy()
    });

    // Gestione degli errori
    client.on('error', (err) => {
      reject(err);
      console.error('Error:', err);
    });
  });
}

function tcpRequest(rawHttpRequest) {
  return new Promise((resolve, reject) => {
    const { hostname, port } = extractHostAndPort(rawHttpRequest);

    let responseData = Buffer.alloc(0); // Inizializza un buffer vuoto per accumulare i dati

    console.log(hostname);
    console.log(port);

    // Creazione di un socket TCP
    const client = net.createConnection(port, hostname, () => {
      client.write(rawHttpRequest); // Invia la richiesta HTTP raw
    });

    // Ricevi i dati dalla risposta del server
    client.on('data', (data) => {
      responseData = Buffer.concat([responseData, data]); // Accumula i dati ricevuti
    });

    // Quando la connessione si chiude
    client.on('end', () => {
      console.log('Connection closed');
      resolve(responseData);
    });

    // Gestione degli errori
    client.on('error', (err) => {
      reject(err);
      console.error('Error:', err);
    });
  });
}

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
    ws.send(Buffer.concat([Buffer.from(uuid), data]));
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

/**
 * Estrai solo l'host e la porta dalla stringa raw HTTP senza doverla parsare tutta.
 * @param {string} rawHttp - La stringa HTTP raw.
 * @returns {Object} - L'host e la porta.
 */
function extractHostAndPort(rawHttp) {
  const hostPattern = /Host:\s*([^\r\n]+)/i; // Regex per trovare la linea Host
  const rawHttpString = rawHttp.toString('utf-8');
  const match = rawHttpString.match(hostPattern);

  if (!match) {
    throw new Error('Host non trovato nella stringa HTTP raw');
  }

  const host = match[1];
  const [hostname, port = 443] = host.split(':'); // Porta di default 443 per HTTPS

  return { hostname, port: parseInt(port, 10) };
}

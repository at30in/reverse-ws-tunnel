const WebSocket = require('ws');
const net = require('net');
const Buffer = require('buffer').Buffer;
const tls = require('tls');
const { Writable } = require('stream');

const tunnelPort = 1234;

const RECONNECT_INTERVAL = 1000 * 5;

// Indirizzo del server WebSocket a cui ci si vuole connettere
const serverUrl = 'wss://user.ycs.dev.yousolution.cloud/websocket-tunnel'; // Cambia questo con l'URL del server a cui vuoi connetterti
// const serverUrl = 'wss://flows.yousolution.cloud/websocket-tunnel'; // Cambia questo con l'URL del server a cui vuoi connetterti
// Token di autenticazione (Bearer Token)
// const token = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9kdWNlckxheWVyb25lIiwic3ViIjoiNjU5ZWFmZTk4YjRkODQwMDExMDM4MWYyIiwicm9sZSI6IldlYlNlcnZpY2UiLCJjb21wYW55IjoiNjU5ZWFmZTk4YjRkODQwMDExMDM4MWYxIiwiaWF0IjoxNzA0ODk4NTM3fQ.X320faLFLZYRB-BJepa7j_GO-6kq1Rz_9F6CtpO-I61ZZ7WI_ALADQfD4NBygsIkV1IzsZOAVvQlmB1Nff-5bg`; // Sostituisci con il tuo Bearer Token
const token = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9kdWNlckxheWVyb25lIiwic3ViIjoiNjA4N2E4YjEyNWI4MjUwMDE2NjBhNzEyIiwicm9sZSI6IldlYlNlcnZpY2UiLCJjb21wYW55IjoiNjA4N2E4YjEyNWI4MjUwMDE2NjBhNzExIiwiaWF0IjoxNjE5NTAzMjgxfQ.TlzV2Rj0WKfVZWpoZTMUSrSyzKM7f-DJ3bXpO_FXjUb4eEepGQRLspWOwjfAW81apuCc0PhfT6S9vHc8wy3IWg`; // Sostituisci con il tuo Bearer Token

// Opzioni per la connessione WebSocket
const options = {
  headers: {
    Authorization: `Bearer ${token}`,
    'x-websocket-tunnel-port': tunnelPort,
  },
};

function connectWebSocket() {
  // Crea una connessione al server WebSocket
  const ws = new WebSocket(serverUrl, options);

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
    console.log('Received Base64 encoded HTTP RAW request:');

    // Decodifica la stringa Base64
    try {
      // const request = JSON.parse(Buffer.from(data, 'base64').toString('utf-8'));
      // const rawHttpRequest = Buffer.from(request.httpRequest, 'base64').toString('utf-8');
      // console.log('Decoded HTTP RAW Request:', request.httpRequest);

      const extractedUUID = data.slice(0, 36);
      console.log(extractedUUID);
      const res = await incomingRequest(data.slice(36)); // tolgo dal buffer uuid
      // console.log('======');
      // console.log(res.toString('utf-8'));
      // console.log('======');
      ws.send(Buffer.concat([extractedUUID, res]));
    } catch (error) {
      console.log(error);
    }
  });

  // Gestione degli errori di connessione
  ws.on('error', (error) => {
    console.error('Error occurred: ', error);
  });

  // Quando la connessione è chiusa, stampa un messaggio
  ws.on('close', () => {
    console.log('Disconnected from the WebSocket server');
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

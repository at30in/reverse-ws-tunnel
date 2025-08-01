/**
 * Copyright 2015 Atsushi Kojo.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
const WebSocket = require('ws');
const { Buffer } = require('buffer');
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const tls = require('tls');

const PING_INTERVAL = 1000 * 30; // in seconds
const instances = {};
const HTTP_TIMEOUT = 1000 * 30; // in seconds
const RECONNECT_INTERVAL = 1000 * 5;

function WSTunnelServer(options) {
  instances[options.id] = instances[options.id] || {};
  instances[options.id].server = instances[options.id].server || null;
  instances[options.id].wss = instances[options.id].wss || null;
  instances[options.id].websocketServer = instances[options.id].websocketServer || null;

  const id = options.id;

  const port = options.port;
  const srcAddr = options.srcAddr || 'localhost';
  const srcPort = options.srcPort || 8083;
  const dstAddr = options.dstAddr || 'localhost';
  const dstPort = options.dstPort || 80;
  const timeout = options.timeout || HTTP_TIMEOUT;
  // const port = 4443;

  // console.log('+++++++++ OPTIONS ++++++++');
  // console.log(port);
  // console.log(dstPort);
  // console.log(dstAddr);
  // console.log(timeout);
  // console.log('+++++++++ OPTIONS ++++++++');
  const TCPOptions = {
    id,
    port,
    srcAddr,
    srcPort,
    dstAddr,
    dstPort,
    timeout,
  };

  if (instances[options.id].server) {
    instances[options.id].server.close(() => {
      TCPServer(TCPOptions);
    });
  } else {
    TCPServer(TCPOptions);
  }

  if (instances[options.id].wss) {
    instances[options.id].wss.close(() => {
      webSocketServer(TCPOptions);
    });
  } else {
    webSocketServer(TCPOptions);
  }
}

function requestFromServer(message, options) {
  return new Promise((resolve, reject) => {
    if (!instances[options.id].websocketServer) {
      return reject(new WebsocketTunnelError('WebSocket connection not established.', 500));
    }

    const uuid = uuidv4();
    const uuidBuffer = Buffer.from(uuid);
    const resultBuffer = Buffer.concat([uuidBuffer, Buffer.from(message)]);

    const timeoutId = setTimeout(() => {
      clearTimeout(timeoutId);
      reject('Timeout: No response from the client.');
    }, options.timeout);

    const onMessage = (response) => {
      // console.log(response.toString());
      const extractedUUID = response.slice(0, 36);
      if (Buffer.compare(uuidBuffer, extractedUUID) === 0) {
        resolve(response.slice(36));
        instances[options.id].websocketServer.removeListener('message', onMessage);
        clearTimeout(timeoutId);
      }
    };
    instances[options.id].websocketServer.on('message', onMessage);

    instances[options.id].websocketServer.send(resultBuffer);
  });
}

function webSocketServer(options) {
  try {
    instances[options.id].wss = new WebSocket.Server({ port: options.port });
  } catch (error) {
    console.log(error);
    return;
  }

  instances[options.id].wss.on('listening', () => {
    console.log(`WebSocket server is listening on port ${options.port}`);
  });

  instances[options.id].wss.on('connection', (ws) => {
    if (instances[options.id].websocketServer) {
      console.log('WebSocket tunnel is already active');
      ws.close();
      return;
    }

    console.log('WebSocket tunnel established');
    instances[options.id].websocketServer = ws;

    // Invia un messaggio di benvenuto al client appena connesso
    // ws.send('Ciao dal server WebSocket!');

    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping(); // invia un ping al client
        console.log('Ping inviato al client');
      }
    }, PING_INTERVAL);

    // Quando si verifica un errore
    ws.on('error', function error(err) {
      instances[options.id].websocketServer = null;
      console.error('WebSocket error:', err);
      clearInterval(interval); // pulisci l'intervallo quando la connessione è chiusa
    });

    // Gestiamo i messaggi ricevuti dal client
    ws.on('message', (data) => {
      const uuid = data.slice(0, 36);
      data = data.slice(36);

      if (instances[options.id][uuid] && instances[options.id][uuid].socket) {
        instances[options.id][uuid].socket.write(data);
      }
      console.log(`Messaggio ricevuto dal client:`);
      console.log(data);
      // console.log(`Messaggio ricevuto dal client: ${data}`);
      // Rispondiamo al client
      // ws.send(`Hai detto: ${data}`);
    });

    // Gestiamo la chiusura della connessione
    ws.on('close', () => {
      console.log('WebSocket tunnel closed');
      instances[options.id].websocketServer = null;
      clearInterval(interval); // pulisci l'intervallo quando la connessione è chiusa
    });

    // Quando ricevi un pong dal client
    ws.on('pong', () => {
      console.log('Pong ricevuto dal client');
    });
  });

  instances[options.id].wss.on('error', (error) => {
    console.log(error);
  });
}

function TCPServer(options) {
  instances[options.id].server = net.createServer((socket) => {
    if (!instances[options.id].websocketServer) {
      console.error('Websocket connection is not established');
      return;
    }
    const uuid = uuidv4();
    const uuidBuffer = Buffer.from(uuid);

    console.log(`Client connesso ${uuid}`);
    // Mantenere la connessione viva
    // socket.setKeepAlive(true);

    // Variabile per memorizzare i dati grezzi della richiesta
    // let rawRequestData = '';
    instances[options.id][uuid] = { socket };
    // instances[options.id][uuid].socket = socket;

    // Leggi i dati grezzi dal socket
    socket.on('data', async (data) => {
      // console.log('DATA');
      // console.log(data);
      if (instances[options.id].websocketServer) {
        instances[options.id].websocketServer.send(Buffer.concat([uuidBuffer, Buffer.from(data)]));
      }
    });

    socket.on('close', () => {
      console.log('Client closed connection');
      delete instances[options.id][uuid];
    });

    socket.on('end', () => {
      console.log('Client disconnected');
      if (instances[options.id].websocketServer) {
        instances[options.id].websocketServer.send(Buffer.concat([uuidBuffer, Buffer.from('CLOSE')]));
      }
    });

    socket.on('error', (err) => {
      console.error('Connection error:', err);
      delete instances[options.id][uuid];
    });
  });

  try {
    instances[options.id].server.listen(options.srcPort, () => {
      console.log(`TCP server listening on port ${options.srcPort}`);
    });
    instances[options.id].server.on('error', (error) => {
      console.log(error);
    });
  } catch (error) {
    console.log(error);
  }
}

function getProtocolAndHostAndDefautlPort(url) {
  try {
    const protocolPorts = {
      http: 80,
      https: 443,
      ftp: 21,
      ssh: 22,
      mssql: 1433,
    };
    // Add "http://" as a default protocol
    if (!/^https?:\/\//i.test(url)) {
      url = 'http://' + url;
    }
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol.replace(':', '');
    const host = parsedUrl.hostname;

    const port = parsedUrl.port || protocolPorts[protocol] || null;

    return [protocol, host, port];
  } catch (error) {
    console.error('Invalid URL:', error);
    return null;
  }
}

class WebsocketTunnelError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

WSTunnelServer({ id: 1, port: 4443 });

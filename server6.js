const WebSocket = require('ws');
const { Buffer } = require('buffer');
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const tls = require('tls');

const PING_INTERVAL = 1000 * 30; // in seconds
const instances = {};
const HTTP_TIMEOUT = 1000 * 30; // in seconds
const RECONNECT_INTERVAL = 1000 * 5;

const MESSAGE_TYPE_CONFIG = 0x01;
const MESSAGE_TYPE_DATA = 0x02;

const id = 1;
const port = process.env.PORT || 4443;
const srcAddr = process.env.SRC_ADDR || 'localhost';
const srcPort = process.env.SRC_PORT || 8083;
const dstAddr = process.env.DST_ADDR || 'localhost';
const dstPort = process.env.DST_PORT || 80;
const timeout = HTTP_TIMEOUT;

const TCPOptions = {
  id,
  port,
  srcAddr,
  srcPort,
  dstAddr,
  dstPort,
  timeout,
};

function WSTunnelServer(options) {
  instances[options.id] = instances[options.id] || {};
  instances[options.id].server = instances[options.id].server || null;
  instances[options.id].wss = instances[options.id].wss || null;
  instances[options.id].websocketServers = instances[options.id].websocketServers || {};
  instances[options.id].tcpServers = instances[options.id].tcpServers || {};

  const id = options.id;

  // const port = options.port;
  // const srcAddr = options.srcAddr || 'localhost';
  // const srcPort = options.srcPort || 8083;
  // const dstAddr = options.dstAddr || 'localhost';
  // const dstPort = options.dstPort || 80;
  // const timeout = options.timeout || HTTP_TIMEOUT;

  // const TCPOptions = {
  //   id,
  //   port,
  //   srcAddr,
  //   srcPort,
  //   dstAddr,
  //   dstPort,
  //   timeout,
  // };

  // if (instances[options.id].server) {
  //   instances[options.id].server.close(() => {
  //     TCPServer(TCPOptions);
  //   });
  // } else {
  //   TCPServer(TCPOptions);
  // }

  if (instances[options.id].wss) {
    instances[options.id].wss.close(() => {
      webSocketServer(TCPOptions);
    });
  } else {
    webSocketServer(TCPOptions);
  }
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
    // if (instances[options.id].websocketServer) {
    //   console.log('WebSocket tunnel is already active');
    //   ws.close();
    //   return;
    // }

    const tunnelId = uuidv4();
    instances[options.id].websocketServers[tunnelId] = ws;
    console.log(`WebSocket tunnel [${tunnelId}] established`);

    // instances[options.id].websocketServer = ws;

    // Invia un messaggio di benvenuto al client appena connesso
    // ws.send('Ciao dal server WebSocket!');

    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping(); // invia un ping al client
        console.log(`Ping inviato al client su tunnel [${tunnelId}]`);
      }
    }, PING_INTERVAL);

    // Quando si verifica un errore
    ws.on('error', function error(err) {
      // instances[options.id].websocketServer = null;
      delete instances[options.id].websocketServers[tunnelId];
      instances[options.id].tcpServers[tunnelId].close(() => {
        console.log(`Server TCP chiuso [${tunnelId}]`);
      });
      console.error('WebSocket error:', err);
      clearInterval(interval); // pulisci l'intervallo quando la connessione è chiusa
    });

    // Gestiamo i messaggi ricevuti dal client
    ws.on('message', (data) => {
      const uuid = data.slice(0, 36);
      const type = data.readUInt8(36);
      if (type === MESSAGE_TYPE_CONFIG) {
        console.log('Messaggio di configurazione');
        data = data.slice(37);
        data = JSON.parse(data);
        TCPServer({ ...TCPOptions, ...{ tunnelId, srcPort: data.srcPort } });
      } else {
        data = data.slice(37);
      }

      if (instances[options.id][uuid] && instances[options.id][uuid].socket) {
        instances[options.id][uuid].socket.write(data);
      }
      console.log(type);
      console.log(`Messaggio ricevuto dal client:`);
      console.log(data.toString('utf8'));
      // console.log(`Messaggio ricevuto dal client: ${data}`);
      // Rispondiamo al client
      // ws.send(`Hai detto: ${data}`);
    });

    // Gestiamo la chiusura della connessione
    ws.on('close', () => {
      console.log(`WebSocket tunnel [${tunnelId}] closed`);
      instances[options.id].tcpServers[tunnelId].close(() => {
        console.log(`Server TCP chiuso [${tunnelId}]`);
      });
      // instances[options.id].websocketServer = null;
      delete instances[options.id].websocketServers[tunnelId];
      clearInterval(interval); // pulisci l'intervallo quando la connessione è chiusa
    });

    // Quando ricevi un pong dal client
    ws.on('pong', () => {
      console.log(`Pong ricevuto dal client sul tunnel [${tunnelId}]`);
    });
  });

  instances[options.id].wss.on('error', (error) => {
    console.log(error);
  });
}

function TCPServer(options) {
  instances[options.id].tcpServers[options.tunnelId] = net.createServer((socket) => {
    if (!instances[options.id].websocketServers[options.tunnelId]) {
      console.error('Websocket connection is not established');
      return;
    }
    const uuid = uuidv4();
    const uuidBuffer = Buffer.from(uuid);

    console.log(`Client [${uuid}] connesso su tunnel [${options.tunnelId}]`);
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
      if (instances[options.id].websocketServers[options.tunnelId]) {
        instances[options.id].websocketServers[options.tunnelId].send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from(data)]));
        // instances[options.id].websocketServer.send(Buffer.concat([uuidBuffer, Buffer.from(data)]));
      }
    });

    socket.on('close', () => {
      console.log('Client closed connection');
      delete instances[options.id][uuid];
    });

    socket.on('end', () => {
      console.log('Client disconnected');
      if (instances[options.id].websocketServers[options.tunnelId]) {
        instances[options.id].websocketServers[options.tunnelId].send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from('CLOSE')]));
      }
    });

    socket.on('error', (err) => {
      console.error('Connection error:', err);
      delete instances[options.id][uuid];
    });
  });

  try {
    instances[options.id].tcpServers[options.tunnelId].listen(options.srcPort, () => {
      console.log(`TCP server listening on port ${options.srcPort}`);
    });
    instances[options.id].tcpServers[options.tunnelId].on('error', (error) => {
      console.log(error);
    });
  } catch (error) {
    console.log(error);
  }
}

WSTunnelServer({ id: 1, port });

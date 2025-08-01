// const state = {
//   websocketTunnels: {
//     [tunnelId]: {
//       ws: WebSocket,              // connessione WebSocket
//       tcpConnections: {           // tutte le connessioni TCP attive per questo tunnel
//         [connectionId]: {
//           socket: net.Socket,
//         }
//       },
//     },
//     httpConnections: {           // tutte le connessioni HTTP attive per questo tunnel
//         [connectionId]: {
//           res: Http.res,
//         }
//       },
//     }
//   },
//   tcpServer: net.Server,          // unico TCP server condiviso
//   httpServer: net.HttpServer
//   websocketServer: net.WebsocketServer
// };

const WebSocket = require('ws');
const { Buffer } = require('buffer');
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const tls = require('tls');
const cookie = require('cookie');
const http = require('http');
const { HTTPParser, methods } = require('http-parser-js');

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
const state = {
  websocketTunnels: {},
};

let TCPOptions = {
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
  state.webSocketServer = state.webSocketServer || null;
  instances[options.id].websocketServers = instances[options.id].websocketServers || {};
  instances[options.id].tcpServers = instances[options.id].tcpServers || {};

  const id = options.id;

  if (state.tcpServer) {
    state.tcpServer.close(() => {
      TCPServer(TCPOptions);
    });
  } else {
    TCPServer(TCPOptions);
  }

  if (state.webSocketServer) {
    state.webSocketServer.close(() => {
      webSocketServer(TCPOptions);
    });
  } else {
    webSocketServer(TCPOptions);
  }
}

function webSocketServer(options) {
  try {
    state.webSocketServer = new WebSocket.Server({ port: options.port });
  } catch (error) {
    console.log(error);
    return;
  }

  state.webSocketServer.on('listening', () => {
    console.log(`WebSocket server is listening on port ${options.port}`);
  });

  state.webSocketServer.on('connection', (ws) => {
    // if (instances[options.id].websocketServer) {
    //   console.log('WebSocket tunnel is already active');
    //   ws.close();
    //   return;
    // }

    // const tunnelId = uuidv4();
    // const tunnelId = '1cf2755f-c151-4281-b3f0-55c399035f89';
    // state.websocketTunnels[tunnelId] = { ws };
    // state.websocketTunnels[tunnelId].tcpConnections = {};
    // state.websocketTunnels[tunnelId].httpConnections = {};
    console.log(`WebSocket connetion established`);
    // console.log(`WebSocket tunnel [${tunnelId}] established`);

    // instances[options.id].websocketServer = ws;

    // Invia un messaggio di benvenuto al client appena connesso
    // ws.send('Ciao dal server WebSocket!');

    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping(); // invia un ping al client
        // console.log(`Ping inviato al client su tunnel [${tunnelId}]`);
        console.log(`Ping inviato al client`);
      }
    }, PING_INTERVAL);

    // Quando si verifica un errore
    ws.on('error', function error(err) {
      delete state.websocketTunnels[tunnelId];
      console.error('WebSocket error:', err);
      clearInterval(interval); // pulisci l'intervallo quando la connessione è chiusa
    });

    let incompleteBuffer = Buffer.alloc(0); // buffer in cui accumulo dati

    ws.on('message', (chunk) => {
      incompleteBuffer = Buffer.concat([incompleteBuffer, chunk]);

      while (incompleteBuffer.length >= 4) {
        const messageLength = incompleteBuffer.readUInt32BE(0);

        if (incompleteBuffer.length < 4 + messageLength) {
          // Il messaggio non è ancora completo, aspetta altro
          break;
        }

        const messageBuffer = incompleteBuffer.slice(4, 4 + messageLength);
        incompleteBuffer = incompleteBuffer.slice(4 + messageLength);

        // Ora puoi parse-are:
        const uuidTunnel = messageBuffer.slice(0, 36).toString();
        const uuid = messageBuffer.slice(36, 72).toString();
        const type = messageBuffer.readUInt8(72);
        const payload = messageBuffer.slice(73);

        handleParsedMessage(ws, uuidTunnel, uuid, type, payload);
      }
    });

    // Gestiamo i messaggi ricevuti dal client
    // ws.on('message', (data) => {
    //   const uuid = data.slice(0, 36);
    //   const type = data.readUInt8(36);
    //   if (type === MESSAGE_TYPE_CONFIG) {
    //     console.log('Messaggio di configurazione');
    //     data = data.slice(37);
    //     data = JSON.parse(data);
    //     // TCPServer({ ...TCPOptions, ...{ tunnelId, srcPort: data.srcPort } });
    //   } else {
    //     data = data.slice(37);
    //   }

    //   if (state.websocketTunnels[tunnelId].tcpConnections[uuid] && state.websocketTunnels[tunnelId].tcpConnections[uuid].socket) {
    //     state.websocketTunnels[tunnelId].tcpConnections[uuid].socket.write(data);
    //   }
    //   console.log(type);
    //   console.log(`Messaggio ricevuto dal client:`);
    //   console.log(data.toString('utf8'));
    //   // console.log(`Messaggio ricevuto dal client: ${data}`);
    //   // Rispondiamo al client
    //   // ws.send(`Hai detto: ${data}`);
    // });

    // Gestiamo la chiusura della connessione
    ws.on('close', () => {
      console.log(`WebSocket tunnel closed`);
      if (tunnelId) {
        delete state.websocketTunnels[tunnelId];
      }
      // console.log(`WebSocket tunnel [${tunnelId}] closed`);

      clearInterval(interval); // pulisci l'intervallo quando la connessione è chiusa
    });

    // Quando ricevi un pong dal client
    ws.on('pong', () => {
      // console.log(`Pong ricevuto dal client sul tunnel [${tunnelId}]`);
      console.log(`Pong ricevuto dal client`);
    });
  });

  state.webSocketServer.on('error', (error) => {
    console.log(error);
  });
}

function handleParsedMessage(ws, tunnelId, uuid, type, payload) {
  if (type === MESSAGE_TYPE_CONFIG) {
    console.log('Messaggio di configurazione');
    payload = JSON.parse(payload);

    console.log(payload);
    // TCPOptions = { ...TCPOptions, ...{ tunnelId } };
    // TCPOptions.tunnelId = tunnelId;
    // console.log('+++++++++++');
    // console.log(TCPOptions);
    // console.log('+++++++++++');

    const tunnelId = payload.uuidTunnel;
    state.websocketTunnels[tunnelId] = { ws };
    state.websocketTunnels[tunnelId].tcpConnections = {};
    state.websocketTunnels[tunnelId].httpConnections = {};
    console.log(`WebSocket tunnel [${tunnelId}] established`);
    // TCPServer({ ...TCPOptions, ...{ tunnelId, srcPort: data.srcPort } });
  }
  console.log(tunnelId);
  if (state.websocketTunnels[tunnelId].tcpConnections[uuid] && state.websocketTunnels[tunnelId].tcpConnections[uuid].socket) {
    state.websocketTunnels[tunnelId].tcpConnections[uuid].socket.write(payload);
  }
  console.log(type);
  console.log(`Messaggio ricevuto dal client:`);
  if (type === MESSAGE_TYPE_CONFIG) {
    console.log(JSON.stringify(payload));
  } else {
    payload.toString('utf8');
  }
}

// TCP SERVER RAW FUNZIONANTE
function TCPServerFUNZIONANTE(options) {
  state.tcpServer = net.createServer((socket) => {
    console.log(options);
    if (!state.websocketTunnels[options.tunnelId] || !state.websocketTunnels[options.tunnelId].ws) {
      console.error('Websocket connection is not established');
      return;
    }
    const uuid = uuidv4();
    const uuidBuffer = Buffer.from(uuid);

    console.log(`Client TCP [${uuid}] connesso su tunnel [${options.tunnelId}]`);
    // Mantenere la connessione viva
    // socket.setKeepAlive(true);

    // let rawRequestData = '';
    state.websocketTunnels[options.tunnelId].tcpConnections[uuid] = { socket };

    // Leggi i dati grezzi dal socket
    socket.on('data', async (data) => {
      // console.log('DATA');
      // console.log(data);
      if (state.websocketTunnels[options.tunnelId] && state.websocketTunnels[options.tunnelId].ws) {
        state.websocketTunnels[options.tunnelId].ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from(data)]));
        // instances[options.id].websocketServer.send(Buffer.concat([uuidBuffer, Buffer.from(data)]));
      }
    });

    socket.on('close', () => {
      console.log('Client closed connection');
      delete state.websocketTunnels[options.tunnelId].tcpConnections[uuid];
    });

    socket.on('end', () => {
      console.log('Client disconnected');
      if (state.websocketTunnels[options.tunnelId] && state.websocketTunnels[options.tunnelId].ws) {
        state.websocketTunnels[options.tunnelId].ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from('CLOSE')]));
      }
    });

    socket.on('error', (err) => {
      console.error('Connection error:', err);
      delete state.websocketTunnels[options.tunnelId].tcpConnections[uuid];
    });
  });

  try {
    state.tcpServer.listen(options.srcPort, () => {
      console.log(`TCP server listening on port ${options.srcPort}`);
    });
    state.tcpServer.on('error', (error) => {
      console.log(error);
    });
  } catch (error) {
    console.log(error);
  }
}

// PARSING HTTP SU TCP SERVER
function TCPServer_SENZA_WEBSOCKET(options) {
  state.tcpServer = net.createServer((socket) => {
    const uuid = uuidv4();
    const uuidBuffer = Buffer.from(uuid);
    let currentTunnelId = null;

    // Funzione per creare e configurare un nuovo parser
    function createHTTPParser() {
      const parser = new HTTPParser(HTTPParser.REQUEST);
      // const METHODS = HTTPParser.METHODS;

      parser[HTTPParser.kOnHeadersComplete] = (info) => {
        const methodName = methods[info.method] || 'UNKNOWN';
        const headers = info.headers.reduce((acc, val, i, arr) => {
          if (i % 2 === 0) acc[val.toLowerCase()] = arr[i + 1];
          return acc;
        }, {});

        // Tunnel ID da header o cookie
        if (headers['tunnel-id']) {
          currentTunnelId = headers['tunnel-id'];
        } else if (headers['cookie']) {
          const cookies = cookie.parse(headers['cookie']);
          currentTunnelId = cookies['tunnel-id'];
        }
        if (!currentTunnelId || !state.websocketTunnels[currentTunnelId] || !state.websocketTunnels[currentTunnelId].ws) {
          console.error('Tunnel non valido:', currentTunnelId);
          socket.destroy();
          return;
        }

        if (!state.websocketTunnels[currentTunnelId].tcpConnections[uuid]) {
          state.websocketTunnels[currentTunnelId].tcpConnections[uuid] = { socket };
        }

        console.log(`Richiesta HTTP ricevuta tramite tunnel [${currentTunnelId}]`);

        // Inoltra headers (come stringa)
        const headersRaw =
          `${methodName} ${info.url} HTTP/${info.versionMajor}.${info.versionMinor}\r\n` +
          info.headers
            .map((v, i) => (i % 2 === 0 ? `${v}: ${info.headers[i + 1]}` : null))
            .filter(Boolean)
            .join('\r\n') +
          '\r\n\r\n';

        state.websocketTunnels[currentTunnelId].ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from(headersRaw)]));
      };

      parser[HTTPParser.kOnBody] = (chunk, offset, length) => {
        if (currentTunnelId && state.websocketTunnels[currentTunnelId]?.ws) {
          const data = chunk.slice(offset, offset + length);
          state.websocketTunnels[currentTunnelId].ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), data]));
        }
      };

      parser[HTTPParser.kOnMessageComplete] = () => {
        // Reinizializza il parser per eventuali altre richieste (keep-alive)
        console.log('Inizio lettura messaggio');
        currentParser = createHTTPParser();
      };

      return parser;
    }

    // Crea il parser iniziale
    let currentParser = createHTTPParser();

    socket.on('data', (chunk) => {
      try {
        currentParser.execute(chunk);
      } catch (err) {
        console.error('Errore parsing HTTP:', err);
        socket.destroy();
      }
    });

    socket.on('end', () => {
      if (currentTunnelId && state.websocketTunnels[currentTunnelId]?.ws) {
        state.websocketTunnels[currentTunnelId].ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from('CLOSE')]));
      }
    });

    socket.on('close', () => {
      if (currentTunnelId) {
        delete state.websocketTunnels[currentTunnelId].tcpConnections[uuid];
      }
    });

    socket.on('error', (err) => {
      console.error('Errore socket:', err);
      if (currentTunnelId) {
        delete state.websocketTunnels[currentTunnelId].tcpConnections[uuid];
      }
    });
  });

  state.tcpServer.listen(options.srcPort, () => {
    console.log(`TCP server in ascolto sulla porta ${options.srcPort}`);
  });

  state.tcpServer.on('error', (err) => {
    console.error('Errore TCP Server:', err);
  });
}

// PARSING HTTP SU TCP + WEBSOCKET
function TCPServer(options) {
  state.tcpServer = net.createServer((socket) => {
    const uuid = uuidv4();
    const uuidBuffer = Buffer.from(uuid);
    let currentTunnelId = null;
    let isWebSocket = false;

    function createHTTPParser() {
      const parser = new HTTPParser(HTTPParser.REQUEST);

      parser[HTTPParser.kOnHeadersComplete] = (info) => {
        const methodName = methods[info.method] || 'UNKNOWN';
        const headers = info.headers.reduce((acc, val, i, arr) => {
          if (i % 2 === 0) acc[val.toLowerCase()] = arr[i + 1];
          return acc;
        }, {});

        // Estrai tunnel-id
        if (headers['tunnel-id']) {
          currentTunnelId = headers['tunnel-id'];
        } else if (headers['cookie']) {
          const cookies = cookie.parse(headers['cookie']);
          currentTunnelId = cookies['tunnel-id'];
        }

        if (!currentTunnelId || !state.websocketTunnels[currentTunnelId]?.ws) {
          console.error('Tunnel non valido:', currentTunnelId);
          socket.destroy();
          return;
        }

        if (!state.websocketTunnels[currentTunnelId].tcpConnections[uuid]) {
          state.websocketTunnels[currentTunnelId].tcpConnections[uuid] = { socket };
        }

        console.log(`Richiesta HTTP ricevuta tramite tunnel [${currentTunnelId}]`);

        const headersRaw =
          `${methodName} ${info.url} HTTP/${info.versionMajor}.${info.versionMinor}\r\n` +
          info.headers
            .map((v, i) => (i % 2 === 0 ? `${v}: ${info.headers[i + 1]}` : null))
            .filter(Boolean)
            .join('\r\n') +
          '\r\n\r\n';

        // Se è un WebSocket, disattiva parsing e inoltra in raw
        if (headers['upgrade']?.toLowerCase() === 'websocket') {
          isWebSocket = true;
          state.websocketTunnels[currentTunnelId].ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from(headersRaw)]));
          parser.close(); // Ferma il parser
        } else {
          // Inoltra header HTTP normale
          state.websocketTunnels[currentTunnelId].ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from(headersRaw)]));
        }
      };

      parser[HTTPParser.kOnBody] = (chunk, offset, length) => {
        if (currentTunnelId && !isWebSocket) {
          const data = chunk.slice(offset, offset + length);
          state.websocketTunnels[currentTunnelId].ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), data]));
        }
      };

      parser[HTTPParser.kOnMessageComplete] = () => {
        if (!isWebSocket) {
          console.log('Fine messaggio HTTP, parser reset');
          currentParser = createHTTPParser();
        }
      };

      return parser;
    }

    let currentParser = createHTTPParser();

    socket.on('data', (chunk) => {
      if (isWebSocket) {
        if (currentTunnelId && state.websocketTunnels[currentTunnelId]?.ws) {
          state.websocketTunnels[currentTunnelId].ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), chunk]));
        }
      } else {
        try {
          currentParser.execute(chunk);
        } catch (err) {
          console.error('Errore parsing HTTP:', err);
          socket.destroy();
        }
      }
    });

    socket.on('end', () => {
      if (currentTunnelId && state.websocketTunnels[currentTunnelId]?.ws) {
        state.websocketTunnels[currentTunnelId].ws.send(Buffer.concat([uuidBuffer, Buffer.from([MESSAGE_TYPE_DATA]), Buffer.from('CLOSE')]));
      }
    });

    socket.on('close', () => {
      if (currentTunnelId) {
        delete state.websocketTunnels[currentTunnelId]?.tcpConnections[uuid];
      }
    });

    socket.on('error', (err) => {
      console.error('Errore socket:', err);
      if (currentTunnelId) {
        delete state.websocketTunnels[currentTunnelId]?.tcpConnections[uuid];
      }
    });
  });

  state.tcpServer.listen(options.srcPort, () => {
    console.log(`TCP server in ascolto sulla porta ${options.srcPort}`);
  });

  state.tcpServer.on('error', (err) => {
    console.error('Errore TCP Server:', err);
  });
}

WSTunnelServer({ id: 1, port });

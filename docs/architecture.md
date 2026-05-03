# Architettura di Reverse WebSocket Tunnel

>Questo documento descrive l'architettura completa della libreria Reverse WebSocket Tunnel, una soluzione per creare tunnel reversi su connessioni WebSocket, permettendo di esporre servizi locali verso l'esterno attraverso un server remoto.

---

## 1. Panoramica Generale

### 1.1 Scopo della Libreria

Reverse WebSocket Tunnel è una libreria Node.js che permette di esporre servizi locali (dietro NAT o firewall) verso l'esterno attraverso un server pubblico. Funziona in modo simile a ngrok o localtunnel, ma utilizza un protocollo binario custom basato su WebSocket.

### 1.2 Componenti Principali

La libreria si divide in due componenti distinti:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         REVERSE WS TUNNEL ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────────────┐              ┌──────────────────────┐           │
│   │      SERVER         │              │       CLIENT         │           │
│   │  (macchina pubblica)│              │  (macchina locale)   │           │
│   │                      │   WebSocket │                      │           │
│   │  ┌──────────────┐   │  ◄────────► │  ┌──────────────┐   │           │
│   │  │ WebSocket    │   │   Tunnel    │  │ WebSocket    │   │           │
│   │  │ Server       │   │             │  │ Client       │   │           │
│   │  │ (porta WS)   │   │             │  │              │   │           │
│   │  └──────────────┘   │             │  └──────────────┘   │           │
│   │         │           │             │         │           │           │
│   │         ▼           │             │         ▼           │           │
│   │  ┌──────────────┐   │             │  ┌──────────────┐   │           │
│   │  │ TCP Server   │   │  HTTP/TCP   │  │ Proxy Server │   │           │
│   │  │ (porta HTTP) │◄──┤  Request   │─►│ (locale)     │   │           │
│   │  └──────────────┘   │             │  └──────────────┘   │           │
│   │         │           │             │         │           │           │
│   └─────────│───────────┘             └─────────│───────────┘           │
│             │                                     │                    │
│             ▼                                     ▼                    │
│        [Internet]                          [Target Service]            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Componente | Descrizione | File |
|------------|-------------|------|
| **WebSocket Server** | Accetta connessioni WebSocket dai client e gestisce il protocollo custom | `server/websocketServer.js` |
| **TCP Server** | Ascolta sulla porta di tunnel entry e inoltra le connessioni al client via WebSocket | `server/tcpServer.js` |
| **Message Handler** | Gestisce i messaggi in arrivo (config, dati, ping/pong) | `server/messageHandler.js` |
| **State Management** | Tiene traccia di tunnel attivi e server TCP | `server/state.js` |
| **WebSocket Client** | Si connette al server e mantiene il tunnel | `client/tunnelClient.js` |
| **HTTP Proxy Server** | Server HTTP locale che inoltra al servizio target | `client/proxyServer.js` |

---

## 2. Flusso dei Dati End-to-End

### 2.1 Sequenza Completa

Il flusso completo per stabilire un tunnel e gestire una richiesta HTTP:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW SEQUENCE                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CLIENT                              SERVER                     TARGET        │
│    │                                    │                         │          │
│    │  1. CONNECT WebSocket              │                         │          │
│    ├───────────────────────────────────►│                         │          │
│    │                                    │                         │          │
│    │  2. SEND MESSAGE_TYPE_CONFIG       │                         │          │
│    │     {TARGET_URL, TUNNEL_ENTRY_PORT}│                         │          │
│    ├───────────────────────────────────►│                         │          │
│    │                                    │                         │          │
│    │                               3. CREATE TCP SERVER          │          │
│    │                               (port 3032)                   │          │
│    │                                    │                         │          │
│    │                               4. TCP SERVER READY          │          │
│    │◄──────────────────────────────────┤                         │          │
│    │                                    │                         │          │
│    │                         [TUNNEL ESTABLISHED]                │          │
│    │                                    │                         │          │
│    │                                    │    5. HTTP REQUEST      │          │
│    │                                    │◄───────────────────────┤          │
│    │                                    │    (port 3032)         │          │
│    │                                    │                         │          │
│    │  6. FORWARD via WebSocket          │                         │          │
│    │     MESSAGE_TYPE_DATA              │                         │          │
│    │◄───────────────────────────────────┤                         │          │
│    │                                    │                         │          │
│    │  7. PROXY to localhost:1880        │                         │          │
│    ├─────────────────────────────────────────────────────────────►│          │
│    │                                    │                         │          │
│    │  8. RESPONSE back through proxy   │                         │          │
│    │◄─────────────────────────────────────────────────────────────│          │
│    │                                    │                         │          │
│    │  9. FORWARD via WebSocket          │                         │          │
│    │     MESSAGE_TYPE_DATA              │                         │          │
│    ├───────────────────────────────────►│                         │          │
│    │                                    │                         │          │
│    │                               10. RESPONSE to client        │          │
│    │◄───────────────────────────────────┤                         │          │
│    │                                    │                         │          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Esempio Dettagliato: Richiesta HTTP

Vediamo cosa succede quando un client esterno fa una richiesta HTTP al server del tunnel:

**Scenario**: Il server ascolta sulla porta 3032 (tunnel entry). Un client esterno fa una richiesta HTTP.

```
PASSO 1: TCP Server riceve la connessione (tcpServer.js, linee 19-140)

    ┌─────────────────────────────────────────────────────────────┐
    │  socket.on('connection')                                    │
    │                                                             │
    │  1. Crea un nuovo parser HTTP (http-parser-js)             │
    │  2. Parsa gli header HTTP in arrivo                         │
    │  3. Estrae tunnelId da:                                     │
    │     - Header x-tunnel-id (priorità)                         │
    │     - Cookie x-tunnel-id                                    │
    │  4. Cerca il tunnel in state[wsPort].websocketTunnels[]     │
    │  5. Se tunnel esiste, registra la connessione TCP           │
    │  6. Invia gli header原始 al client via WebSocket            │
    └─────────────────────────────────────────────────────────────┘

PASSO 2: I dati HTTP vengono incapsulati nel protocollo custom

    ┌─────────────────────────────────────────────────────────────┐
    │  buildMessageBuffer() - client/utils.js                    │
    │                                                             │
    │  Formato: [4 byte length][36 byte tunnelId]                │
    │                [36 byte uuid][1 byte type][N byte payload]  │
    │                                                             │
    │  Esempio:                                                   │
    │  - tunnelId: "1cf2755f-c151-4281-b3f0-55c399035f87"        │
    │  - uuid: "550e8400-e29b-41d4-a716-446655440000"            │
    │  - type: 0x02 (MESSAGE_TYPE_DATA)                          │
    │  - payload: "GET /api HTTP/1.1\r\nHost: ..."              │
    └─────────────────────────────────────────────────────────────┘

PASSO 3: Il client riceve il messaggio (tunnelClient.js, linee 130-150)

    ┌─────────────────────────────────────────────────────────────┐
    │  ws.on('message')                                          │
    │                                                             │
    │  1. Parsa il messaggio binario                             │
    │  2. Estrae tunnelId, uuid, type, payload                   │
    │  3. Se type == MESSAGE_TYPE_DATA:                         │
    │     - Cerca o crea TCP connection a targetUrl:targetPort │
    │     - Invia i dati al target                               │
    │  4. Se payload == "CLOSE": chiude la connessione TCP      │
    └─────────────────────────────────────────────────────────────┘

PASSO 4: Il proxy server inoltra al target (proxyServer.js, linee 26-40)

    ┌─────────────────────────────────────────────────────────────┐
    │  http-proxy                                                │
    │                                                             │
    │  Il proxy server locale (startHttpProxyServer)            │
    │  inoltra la richiesta al target URL configurato            │
    │  (es. http://localhost:1880)                                │
    └─────────────────────────────────────────────────────────────┘
```

---

## 3. Architettura dei Componenti

### 3.1 Server Side

#### 3.1.1 websocketServer.js - Gestione Connessioni WebSocket

Questo modulo gestisce il server WebSocket principale che accetta le connessioni dai client.

```javascript
// server/websocketServer.js - Struttura chiave

// 1. Creazione del server WebSocket (linea 22)
state[portKey].webSocketServer = new WebSocket.Server({ port, host, path });

// 2. Gestione connessione in ingresso (linee 30-148)
state[portKey].webSocketServer.on('connection', (ws, req) => {
  // - Setup heartbeat (ping/pong)
  // - Parsing messaggi binari
  // - Gestione cleanup
});

// 3. Parsing del protocollo custom (linee 58-107)
ws.on('message', chunk => {
  // Buffer: [4 byte length][36 byte tunnelId][36 byte uuid][1 byte type][payload]
  const length = buffer.readUInt32BE(0);
  const messageTunnelId = message.slice(0, 36).toString();
  const uuid = message.slice(36, 72).toString();
  const type = message.readUInt8(72);
  const payload = message.slice(73);

  handleParsedMessage(ws, messageTunnelId, uuid, type, payload, ...);
});

// 4. Cleanup alla disconnessione (linee 110-137)
function cleanup(reason) {
  // - Rimuove il tunnel da state
  // - Chiude la connessione WebSocket
  // - Pulisce gli interval
}

// 5. Stop server e cleanup (linee 162-239)
async function stopWebSocketServer(port) {
  // - Chiude tutte le connessioni WebSocket
  // - Chiude tutti i TCP server (per-port e global)
  // - Pulisce lo state
}
```

#### 3.1.2 messageHandler.js - Elaborazione Messaggi

Gestisce i diversi tipi di messaggi ricevuti dal client.

```javascript
// server/messageHandler.js - Tipi di messaggio

// MESSAGE_TYPE_CONFIG (0x01) - linee 25-104
// - Riceve la configurazione del tunnel
// - Crea il TCP server sulla porta TUNNEL_ENTRY_PORT
// - Registra il tunnel nello state

// MESSAGE_TYPE_APP_PING (0x03) - linee 108-124
// - Risponde con MESSAGE_TYPE_APP_PONG

// MESSAGE_TYPE_DATA (0x02) - linee 127-134
// - Inoltra i dati al TCP socket del tunnel
```

#### 3.1.3 tcpServer.js - Server TCP per Ingresso Richieste

Il TCP server ascolta sulla porta di tunnel entry e inoltra le connessioni al client.

```javascript
// server/tcpServer.js - Creazione server TCP

// 1. Creazione server (linee 14-170)
const server = net.createServer({ pauseOnConnect: true }, socket => {
  const uuid = uuidv4();

  // Parsing HTTP per identificare il tunnel
  const parser = new HTTPParser(HTTPParser.REQUEST);
  parser.on('headers', (headers) => {
    // Estrae tunnelId da header o cookie
    currentTunnelId = headers[tunnelIdHeaderName] ||
                      cookie.parse(headers.cookie)[tunnelIdHeaderName];

    // Registra la connessione TCP nel tunnel
    tunnel.tcpConnections[uuid] = { socket };
  });

  // Inoltra i dati al client via WebSocket
  socket.on('data', (chunk) => {
    tunnel.ws.send(buildMessageBuffer(currentTunnelId, uuid, MESSAGE_TYPE_DATA, chunk));
  });
});

// 2. Listening con reuseAddr (linee 160-169)
server.listen({
  port: port,
  host: '0.0.0.0',
  reuseAddr: true,  // Permette riutilizzo rapido della porta
});

// 3. Retry logic per EADDRINUSE (linee 233-258)
async function ensureTCPServer(port, tunnelIdHeaderName, websocketPort) {
  // 5 tentativi con backoff esponenziale
  // Force close della porta se occupata
}
```

#### 3.1.4 state.js - Gestione Stato Globale

```javascript
// server/state.js

module.exports = {
  // Registry globale TCP servers - tiene traccia di tutti i TCP server
  // indipendentemente dalla porta WebSocket
  tcpServers: {}
};

// Lo state per-port contiene:
/*
state[portKey] = {
  webSocketServer: <WebSocket.Server>,
  websocketTunnels: {
    "<tunnelId>": {
      ws: <WebSocket>,
      tcpConnections: {
        "<uuid>": { socket: <net.Socket> }
      }
    }
  },
  "3032": {  // TCP server per porta 3032
    tcpServer: <net.Server>
  }
}
*/
```

### 3.2 Client Side

#### 3.2.1 tunnelClient.js - Client WebSocket

Gestisce la connessione WebSocket al server e l'inoltro dei dati.

```javascript
// client/tunnelClient.js - Struttura principale

// 1. Connessione WebSocket (linee 35-100)
function connectWebSocket(config) {
  ws = new WebSocket(wsUrl, { headers });

  ws.on('open', () => {
    // Invia configurazione tunnel
    const payload = {
      TARGET_URL,
      TARGET_PORT,
      TUNNEL_ENTRY_PORT,
      environment,
      agentVersion
    };
    ws.send(buildMessageBuffer(tunnelId, uuid, MESSAGE_TYPE_CONFIG, JSON.stringify(payload)));
  });

  // 2. Gestione messaggi in arrivo (linee 105-150)
  ws.on('message', (data) => {
    // Parsing del messaggio custom
    // Se MESSAGE_TYPE_DATA: inoltra al TCP client
    // Se MESSAGE_TYPE_APP_PONG: aggiorna stato heartbeat
  });

  // 3. Creazione TCP client verso target (linee 200-230)
  function createTcpClient(targetUrl, targetPort, ws, tunnelId, uuid) {
    const client = net.createConnection(targetPort, hostname);
    client.on('data', (data) => {
      // Invia dati al server via WebSocket
      ws.send(buildMessageBuffer(tunnelId, uuid, MESSAGE_TYPE_DATA, data));
    });
  }
}

// 4. Heartbeat (linee 245-265)
function heartBeat(ws) {
  // WebSocket-level ping ogni 30 secondi
}

// 5. Application-level ping (linee 304-323)
function startAppHeartbeat(ws, tunnelId, pingState) {
  // Ping applicativo ogni 20 secondi con sequence number
}

// 6. Auto-reconnect (linee 175-195)
ws.on('close', () => {
  if (!isClosed && autoReconnect) {
    // Retry con backoff: 1s, 2s, 5s, 10s, 30s
  }
});
```

#### 3.2.2 proxyServer.js - Server HTTP Locale

```javascript
// client/proxyServer.js

function startHttpProxyServer(targetUrl, allowInsecureCerts) {
  const proxy = httpProxy.createProxyServer({});

  const server = http.createServer((req, res) => {
    // Inoltra richieste HTTP al target
    proxy.web(req, res, { target: targetUrl });
  });

  server.on('upgrade', (req, socket, head) => {
    // Inoltra richieste WebSocket
    proxy.ws(req, socket, head, { target: targetUrl });
  });

  server.listen(0);  // Porta dinamica
  return { port: assignedPort, close: ... };
}
```

#### 3.2.3 utils.js - Funzioni di Utilità

```javascript
// client/utils.js - buildMessageBuffer

function buildMessageBuffer(tunnelId, uuid, type, payload) {
  // Costruisce il messaggio binario custom
  //
  // Struttura:
  // [4 byte]  - lunghezza totale (big-endian)
  // [36 byte] - tunnelId (UUID)
  // [36 byte] - uuid (connection UUID)
  // [1 byte]  - message type
  // [N byte]  - payload

  const tunnelBuffer = Buffer.from(tunnelId);
  const uuidBuffer = Buffer.from(uuid);
  const typeBuffer = Buffer.from([type]);
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);

  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(tunnelBuffer.length + uuidBuffer.length +
                              typeBuffer.length + payloadBuffer.length);

  return Buffer.concat([lengthBuffer, tunnelBuffer, uuidBuffer, typeBuffer, payloadBuffer]);
}
```

---

## 4. Protocollo WebSocket Custom

### 4.1 Struttura dei Messaggi

Il protocollo utilizza un formato binario per tutti i messaggi:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MESSAGE FORMAT                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Offset  Size    Field           Description                                │
│  ─────────────────────────────────────────────────────────────────────────  │
│  0       4       length          Total message length (big-endian)         │
│  4       36      tunnelId        UUID del tunnel (36 bytes, padded)        │
│  40      36      uuid            UUID della connessione TCP               │
│  76      1       type            Message type (see below)                  │
│  77      N       payload         Payload data                                │
│                                                                             │
│  Esempio:                                                                   │
│  ┌──────┬────────────────────────────────────┬────────────┬────┬──────────┐ │
│  │ 000C │ 1cf2755f-c151-4281-b3f0-55c399... │ 550e8400...│ 02 │ GET /... │ │
│  │ 4B   │ tunnelId (36B)                    │ uuid (36B) │ 1B │ payload  │ │
│  └──────┴────────────────────────────────────┴────────────┴────┴──────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Tipi di Messaggio

Definiti in `server/constants.js`:

```javascript
// server/constants.js
module.exports = {
  MESSAGE_TYPE_CONFIG: 0x01,    // Configurazione tunnel
  MESSAGE_TYPE_DATA: 0x02,      // Dati TCP
  MESSAGE_TYPE_APP_PING: 0x03,  // Ping a livello applicativo
  MESSAGE_TYPE_APP_PONG: 0x04,  // Pong a livello applicativo
};
```

| Type | Value | Direction | Descrizione |
|------|-------|-----------|-------------|
| `MESSAGE_TYPE_CONFIG` | 0x01 | Client → Server | Configurazione del tunnel (target URL, porte) |
| `MESSAGE_TYPE_DATA` | 0x02 | Bidirezionale | Dati TCP da inoltrare |
| `MESSAGE_TYPE_APP_PING` | 0x03 | Server → Client | Ping applicativo con sequence number |
| `MESSAGE_TYPE_APP_PONG` | 0x04 | Client → Server | Risposta al ping applicativo |

### 4.3 Identificazione del Tunnel

Il tunnelId viene estratto in due modi:

1. **Dal messaggio WebSocket**: Ogni messaggio contiene il tunnelId nei primi 36 byte
2. **Dalla richiesta HTTP in ingresso**: Il TCP server estrae il tunnelId dagli header HTTP:

```javascript
// server/tcpServer.js - Linee 38-43

// Priorità 1: Header x-tunnel-id
if (headers[tunnelIdHeaderName]) {
  currentTunnelId = headers[tunnelIdHeaderName];
}
// Priorità 2: Cookie
else if (headers['cookie']) {
  currentTunnelId = cookie.parse(headers['cookie'])[tunnelIdHeaderName];
}
```

### 4.4 Apertura e Chiusura Connessioni

**Apertura (Client → Server)**:

```
1. Client invia MESSAGE_TYPE_CONFIG con:
   {
     TARGET_URL: "http://localhost:1880",
     TARGET_PORT: 52541,
     TUNNEL_ENTRY_URL: "http://localhost:3032",
     TUNNEL_ENTRY_PORT: 3032,
     environment: "production"
   }

2. Server:
   - Crea TCP server su TUNNEL_ENTRY_PORT
   - Registra tunnel in state
   - Log: "Tunnel [xxx] established successfully"
```

**Chiusura (Server → Client)**:

```
1. Quando una connessione TCP termina, il server invia:
   MESSAGE_TYPE_DATA con payload = "CLOSE"

2. Client chiude la connessione TCP verso il target:
   clients[uuid].end()
```

### 4.5 Gestione Errori

```javascript
// server/websocketServer.js - Linee 78-104

// Rifiuto connessioni duplicate
if (existingTunnel && existingTunnel.ws !== ws) {
  if (existingTunnel.ws.readyState === WebSocket.OPEN) {
    ws.close(1008, `Duplicate tunnelId: ${messageTunnelId}`);
    return;
  }
}

// server/tcpServer.js - Linee 136-139

// Errori sulla socket TCP
socket.on('error', (err) => {
  logger.error(`Socket error on tunnel [${currentTunnelId}], uuid [${uuid}]:`, err);
  delete state[wsPortKey]?.websocketTunnels?.[currentTunnelId]?.tcpConnections?.[uuid];
});
```

---

## 5. Gestione dei Tunnel

### 5.1 Creazione Tunnel

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TUNNEL CREATION FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CLIENT                                                                    │
│    │                                                                       │
│    │  connectWebSocket()                                                    │
│    │  - Crea WebSocket verso server                                       │
│    │                                                                       │
│    ├► ws.on('open')                                                        │
│    │    - Costruisce payload configurazione                               │
│    │    - Invia MESSAGE_TYPE_CONFIG                                        │
│    │                                                                       │
│    │                                    SERVER                             │
│    │                                         │                             │
│    │  handleParsedMessage()                    │                           │
│    │  - Parsa JSON config                       │                           │
│    │  - Estrae TUNNEL_ENTRY_PORT                │                           │
│    │                                         │                             │
│    │                                    ensureTCPServer()                  │
│    │                                    - 5 tentativi con retry            │
│    │                                    - reuseAddr: true                 │
│    │                                         │                             │
│    │                                    state[port][portKey] = {tcpServer}│
│    │                                    state.tcpServers[portKey] = tcpSrv│
│    │                                         │                             │
│    │                                    Log: "Tunnel established"          │
│    │                                                                       │
│    │                                                                       │
│    │  Log: "Client connected to tunnel"                                   │
│    │                                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Mapping Porte → Tunnel

Il sistema usa una mappatura dinamica:

```javascript
// Ogni tunnel ha una porta di entry univoca
// TUNNEL_ENTRY_PORT: 3032

// Lo state mantiene:
// state[wsPort][tunnelEntryPort].tcpServer -> TCP server instance

// Quando arriva una richiesta sulla porta 3032:
// 1. Il TCP server riceve la connessione
// 2. Estrae il tunnelId dalla richiesta HTTP
// 3. Cerca il WebSocket corrispondente in state[wsPort].websocketTunnels
// 4. Inoltra i dati
```

### 5.3 Pulizia e Chiusura

```javascript
// server/websocketServer.js - stopWebSocketServer()

// 1. Chiude tutte le connessioni WebSocket attive
for (const tunnel of Object.values(serverState.websocketTunnels)) {
  tunnel.ws.close(1000, 'Server shutting down');
}

// 2. Chiude TCP server nello state per-port
for (const [tcpPort, tcpState] of Object.entries(serverState)) {
  if (tcpState?.tcpServer) {
    tcpState.tcpServer.close();
  }
}

// 3. Chiude TCP server nella registry globale
for (const [tcpPort, tcpServer] of Object.entries(state.tcpServers)) {
  if (tcpServer?.listening) {
    tcpServer.close();
  }
}
state.tcpServers = {};

// 4. Chiude il server WebSocket principale
serverState.webSocketServer.close();

// 5. Pulisce lo state
delete state[portKey];
```

---

## 6. Esempi Pratici

### 6.1 Avvio del Server

```javascript
// examples/server/server-example.js
const { startWebSocketServer, setLogContext } = require('@remotelinker/reverse-ws-tunnel/server');

setLogContext('SERVER');

startWebSocketServer({
  port: 4443,                    // Porta WebSocket
  host: '0.0.0.0',              // Bind address
  path: '/tunnel',               // WebSocket path (opzionale)
  tunnelIdHeaderName: 'x-tunnel-id'  // Header per identificare tunnel
});
```

### 6.2 Avvio del Client

```javascript
// examples/client/client-example.js
const { startClient } = require('@remotelinker/reverse-ws-tunnel/client');

const client = startClient({
  tunnelId: '1cf2755f-c151-4281-b3f0-55c399035f87',
  wsUrl: 'wss://server.com/tunnel',
  targetUrl: 'http://localhost:1880',
  tunnelEntryPort: 3032,
  autoReconnect: true
});

client.on('connected', () => console.log('Connected!'));
client.on('disconnected', () => console.log('Disconnected!'));
```

### 6.3 Test del Tunnel

```bash
# Il server è in ascolto sulla porta 3032 (tunnel entry)
# Per testare il tunnel:

curl -X GET http://server.com:3032 \
  -H "x-tunnel-id: 1cf2755f-c151-4281-b3f0-55c399035f87"

# Oppure con cookie:
curl -X GET http://server.com:3032 \
  -H "Cookie: x-tunnel-id=1cf2755f-c151-4281-b3f0-55c399035f87"
```

### 6.4 Configurazione con Variabili Ambiente

```bash
# Server
export WS_PORT=4443
export TUNNEL_ID_HEADER_NAME=x-tunnel-id
export LOG_LEVEL=debug

# Client
export TUNNEL_ID=1cf2755f-c151-4281-b3f0-55c399035f87
export WS_URL=wss://server.com/tunnel
export TARGET_URL=http://localhost:1880
export TUNNEL_ENTRY_PORT=3032
```

---

## 7. Costanti e Configurazione

### 7.1 Costanti Server

```javascript
// server/constants.js
module.exports = {
  PING_INTERVAL: 1000 * 30,      // 30 secondi - heartbeat WebSocket
  HTTP_TIMEOUT: 1000 * 30,       // 30 secondi - timeout richieste HTTP
  RECONNECT_INTERVAL: 1000 * 5,  // 5 secondi - retry riconnessione
  MESSAGE_TYPE_CONFIG: 0x01,
  MESSAGE_TYPE_DATA: 0x02,
  MESSAGE_TYPE_APP_PING: 0x03,
  MESSAGE_TYPE_APP_PONG: 0x04,
};
```

### 7.2 Costanti Client

```javascript
// client/tunnelClient.js
const PING_INTERVAL = 30 * 1000;      // 30s - WebSocket ping
const PONG_WAIT = 5 * 1000;           // 5s - attesa pong
const APP_PING_INTERVAL = 20 * 1000;  // 20s - application ping
const HEALTH_TIMEOUT = 45 * 1000;     // 45s - health check
const RECONNECT_BACKOFF = [1000, 2000, 5000, 10000, 30000];
```

---

## 8. Diagramma Architetturale Completo

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              ARCHITETTURA COMPLETA                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                              SERVER                                      │   │
│   │  ┌───────────────────────────────────────────────────────────────────┐  │   │
│   │  │                     websocketServer.js                          │  │   │
│   │  │                                                                   │  │   │
│   │  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │  │   │
│   │  │  │   HTTP      │    │   WS        │    │    State            │  │  │   │
│   │  │  │   Request   │    │   Server    │    │    Management      │  │  │   │
│   │  │  │             │    │   (port)    │    │                     │  │  │   │
│   │  │  │ ① TCP Server◄────┼─────────────┼───►│ ② tunnelId mapping │  │  │   │
│   │  │  │  (port 3032)      │             │    │                     │  │  │   │
│   │  │  └─────────────┘    └─────────────┘    │  state[port]        │  │  │   │
│   │  │        │               │               │  state.tcpServers  │  │  │   │
│   │  │        │               │               └─────────────────────┘  │  │   │
│   │  │        │               │                        ▲              │  │   │
│   │  │        │               │                        │              │  │   │
│   │  │        ▼               ▼                        │              │  │   │
│   │  │  ┌──────────────────────────────────────────────────────────┐  │  │   │
│   │  │  │                    messageHandler.js                     │  │  │   │
│   │  │  │                                                            │  │  │   │
│   │  │  │  MESSAGE_TYPE_CONFIG ──► Crea TCP server                 │  │  │   │
│   │  │  │  MESSAGE_TYPE_DATA ──────► Forward to TCP socket        │  │  │   │
│   │  │  │  MESSAGE_TYPE_APP_PING ──► Responds with APP_PONG       │  │  │   │
│   │  │  └──────────────────────────────────────────────────────────┘  │  │   │
│   │  │                              │                                   │  │   │
│   │  └──────────────────────────────┼───────────────────────────────────┘  │   │
│   │                                 │                                        │   │
│   └─────────────────────────────────┼────────────────────────────────────────┘   │
│                                     │                                           │
│                               WebSocket                                        │
│                                     │                                           │
│   ┌─────────────────────────────────┼────────────────────────────────────────┐   │
│   │                                 ▼                                        │   │
│   │  ┌───────────────────────────────────────────────────────────────────┐  │   │
│   │  │                        CLIENT                                    │  │   │
│   │  │                                                                   │  │   │
│   │  │  ┌─────────────────────────────────────────────────────────────┐  │  │   │
│   │  │  │                      tunnelClient.js                       │  │  │   │
│   │  │  │                                                              │  │  │   │
│   │  │  │  ┌─────────────┐    ┌─────────────┐    ┌────────────────┐  │  │  │   │
│   │  │  │  │   WS        │    │   TCP       │    │   Heartbeat    │  │  │  │   │
│   │  │  │  │   Client    │    │   Client    │    │   Manager      │  │  │  │   │
│   │  │  │  │             │    │   (target)  │    │                │  │  │  │   │
│   │  │  │  │◄───────────►│───►│             │    │  - WS ping     │  │  │  │   │
│   │  │  │  │  WebSocket  │    │  net.connect│    │  - App ping    │  │  │  │   │
│   │  │  │  │             │    │             │    │  - Health      │  │  │  │   │
│   │  │  │  └─────────────┘    └─────────────┘    └────────────────┘  │  │  │   │
│   │  │  │        │                    │                    ▲           │  │  │   │
│   │  │  └────────┼────────────────────┼────────────────────┼───────────┘  │  │   │
│   │  │           │                    │                    │               │  │   │
│   │  │           ▼                    ▼                    │               │  │   │
│   │  │  ┌─────────────────────────────────────────────────────────────┐   │  │   │
│   │  │  │                    proxyServer.js                            │   │  │   │
│   │  │  │                                                              │   │  │   │
│   │  │  │   ┌─────────────┐    ┌─────────────┐                        │   │  │   │
│   │  │  │   │   HTTP      │    │   WS        │                        │   │  │   │
│   │  │  │   │   Proxy     │    │   Proxy     │                        │   │  │   │
│   │  │  │   │             │    │             │                        │   │  │   │
│   │  │  │   │ ◄──────────►│◄───│             │                        │   │  │   │
│   │  │  │   │  http-proxy │    │  upgrade    │                        │   │  │   │
│   │  │  │   └─────────────┘    └─────────────┘                        │   │  │   │
│   │  │  │                              │                                │   │  │   │
│   │  │  └──────────────────────────────┼────────────────────────────────┘  │  │
│   │  │                                 │                                     │  │
│   │  └─────────────────────────────────┼─────────────────────────────────────┘  │
│   │                                    │                                        │
│   └────────────────────────────────────┼────────────────────────────────────────┘
│                                        │                                         │
│                                        ▼                                         │
│                              ┌──────────────────┐                              │
│                              │   Target Service │                              │
│                              │   (localhost)    │                              │
│                              └──────────────────┘                              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Riferimenti

- File sorgente principali:
  - `server/websocketServer.js` - Server WebSocket
  - `server/messageHandler.js` - Gestione messaggi
  - `server/tcpServer.js` - Server TCP
  - `server/state.js` - Gestione stato
  - `server/constants.js` - Costanti
  - `client/tunnelClient.js` - Client WebSocket
  - `client/proxyServer.js` - Proxy HTTP locale
  - `client/utils.js` - Utilità protocollo
- Documenti correlati:
  - `docs/heartbeat-mechanism.md` - Dettagli heartbeat
  - `docs/state-management.md` - Gestione stato
  - `docs/ping-pong-architecture.md` - Architettura ping/pong
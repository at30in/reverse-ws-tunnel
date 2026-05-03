# Architettura Ping/Pong: Server e Client

>Questo documento descrive l'architettura completa del meccanismo ping/pong nella libreria Reverse WebSocket Tunnel, distinguendo tra il livello protocollo WebSocket e il livello applicativo.

## Panoramica dei due livelli ping/pong

La libreria utilizza **due meccanismi indipendenti** per verificare la salute della connessione:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DUE LIVELLI PING/PONG                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                             │
│  Livello 1: WebSocket Protocol (TCP)                         │
│  ┌─────────────────────────────────────────────────────┐      │
│  │  ws.ping() ──────────► ws.pong()                   │      │
│  │  (WebSocket API native)                            │      │
│  │  Keep-alive a livello protocollo                   │      │
│  └─────────────────────────────────────────────────────┘      │
│                           ▼                                 │
│  Livello 2: Application Layer (Dati)                         │
│  ┌─────────────────────────────────────────────────────┐      │
│  │  Messaggio dati ──────────► Messaggio dati            │      │
│  │  {type:"ping"}            {type:"pong"}             │      │
│  │  Keep-alive a livello applicativo                 │      │
│  └─────────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Livello 1: WebSocket Protocol Ping/Pong

### Cos'è

Il ping/pong a livello protocollo WebSocket è parte dello standard WebSocket (RFC 6455). È gestito automaticamente dalla libreria `ws` e opera a livello TCP.

- **ping**: Frame binario di CONTROLLO inviatodal server
- **pong**: Risposta automatica del client (via libreria ws) OPPURE risposta manuale

### Flusso

```
Server                                      Client
  │                                            │
  │    ┌─────────────────────────────────┐       │
  │    │  1. setInterval(PING_INTERVAL) │       │
  │    │        every 30 seconds            │       │
  │    └─────────────────────────────────┘       │
  │                    │                         │
  │                    ▼                         │
  │   ┌────────────────────────────────┐        │
  │   │ 2. ws.isAlive = false           │        │
  │   └─���──────────────────────────────┘        │
  │                    │                         │
  │                    ▼                         │
  │   ┌────────────────────────────────┐        │
  │   │ 3. ws.ping()                   │───────►│
  │   │    [frame TCP]                 │        │
  │   └────────────────────────────────┘        │
  │                    │                         │
  │                    │     [automatic pong]    │
  │                    │     OR manual pong     │
  │                    │◄───────────────────────│
  │                    │                         │
  │   ┌────────────────────────────────┐        │
  │   │ 4. ws.isAlive = true (on pong)   │        │
  │   └────────────────────────────────┘        │
  │                    │                         │
  │            [PONG RICEVUTO]                  │
  │                    │                         │
  │   ┌────────────────────────────────┐        │  SE non ricevuto:
  │   │ 5. Check after PING_INTERVAL    │        │  ws.terminate()
  │   │    if (!ws.isAlive)             │        │  (connessione morta)
  │   │      ws.terminate()             │        │
  │   └────────────────────────────────┘        │
  │                                            │
```

### Codice Server (websocketServer.js)

```javascript
// websocketServer.js - Linee 37-56

// Setup heartbeat
ws.isAlive = true;
ws.on('pong', () => {
  ws.isAlive = true;
  logger.debug(`Pong received from client on tunnel [${tunnelId}]`);
});

const interval = setInterval(() => {
  if (!ws.isAlive) {
    logger.warn(
      `No pong received from client on tunnel [${tunnelId}], terminating.`
    );
    return ws.terminate();  // ← TERMINA CONNESSIONE
  }
  ws.isAlive = false;
  if (ws.readyState === WebSocket.OPEN) {
    ws.ping();  // ← INVIA PING
    logger.trace(`Ping sent to client on tunnel [${tunnelId}]`);
  }
}, PING_INTERVAL);  // = 30 secondi (constants.js)
```

### Importante: Il client DEVE rispondere

Per impostazione predefinita, la libreria `ws` risponde automaticamente ai ping con pong. Tuttavia, in alcuni scenari (firewall, NAT, proxy), questa risposta automatica potrebbe essere soppressa.

**Il client DEVE gestire esplicitamente i ping**:

```javascript
// client/tunnelClient.js - DA AGGIUNGERE

ws.on('ping', () => {
  logger.trace('Received server ping, sending pong');
  ws.pong();  // ← RISPOSTA MANUALE AL PING
});
```

>Senza questa risposta, il server NON riceVE il pong e considera la connessione morta.

### Costanti

```javascript
// server/constants.js
PING_INTERVAL: 1000 * 30  // = 30 secondi
```

### Timeout behavior

```
Timeline (30 secondi):

0s  ──► Server invia ping (ws.ping())
     │
30s ──► Server controlla isAlive
     │
     ├──► SE isAlive = true  ──► OK, connessione viva
     │
     └──► SE isAlive = false ──► NOK, TERMINA (ws.terminate())
```

---

## Livello 2: Application Layer Ping/Pong

### Cos'è

Il ping/pong a livello applicativo è un meccanismo custom che opera **sopra** il protocollo WebSocket. Usato per:

1. **Verificare che i dati applicativi fluiscano** correttamente
2. **Tenere traccia sequenziale** delle risposte
3. **Rilevare problemi a livello dati** (非 a livello TCP)

### Flusso

```
Server                                      Client
  │                                            │
  │    ┌─────────────────────────────────┐        │
  │    │ APP_PING_INTERVAL (20s)        │        │
  │    └─────────────────────────────────┘        │
  │                    │                         │
  │                    ▼                         │
  │   ┌────────────────────────────────┐        │
  │   │ buildMessageBuffer(              │        │
  │   │   tunnelId,                    │        │
  │   │   uuid,                        │        │
  │   │   MESSAGE_TYPE_APP_PING,       │──────────────►│
  │   │   {type:"ping", seq:N, ts}    │  DATO        │
  │   └────────────────────────────────┘        │
  │                    │                         │
  │                    ▼                         │
  │   ┌────────────────────────────────┐        │
  │   │ Incrementa pingSeq              │        │
  │   │ (0 → 1 → 2 → ...)             │        │
  │   └────────────────────────────────┘        │
  │                    │                         │
  │                    ▼                         │
  │              [APP_PONG RICEVUTO]             │
  │                    │                         │
  │   ┌────────────────────────────────┐        │
  │   │ Verifica seq corrispondenza    │        │
  │   │ Aggiorna lastPongTs            │        │
  │   └────────────────────────────────┘        │
  │                                            │
```

### Codice Client (tunnelClient.js)

```javascript
// client/tunnelClient.js - Linee 14-16

const PING_INTERVAL = 30 * 1000;    // 30 secondi - WebSocket level
const APP_PING_INTERVAL = 20 * 1000; // 20 secondi - Application level
const PONG_WAIT = 10 * 1000;        // 10 secondi - Wait for pong
const HEALTH_TIMEOUT = 45 * 1000;    // 45 secondi - Health check
```

#### Application-level heartbeat (20s)

```javascript
// tunnelClient.js - Linee 306-323

/**
 * Starts the application-level heartbeat (ping every 20 seconds)
 */
function startAppHeartbeat(ws, tunnelId, pingState) {
  return setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      pingState.incPingSeq();
      const currentPingSeq = pingState.pingSeq();
      const pingData = JSON.stringify({
        type: 'ping',
        seq: currentPingSeq,
        ts: Date.now(),
      });

      const message = buildMessageBuffer(
        tunnelId, 
        uuidv4(), 
        MESSAGE_TYPE_APP_PING, 
        pingData
      );
      ws.send(message);

      logger.trace(`App ping sent: seq=${currentPingSeq}`);
    }
  }, APP_PING_INTERVAL);  // = 20 secondi
}
```

#### Health monitoring (5s check, 45s timeout)

```javascript
// tunnelClient.js - Linee 328-337

function startHealthMonitor(ws, tunnelId, pongState) {
  return setInterval(() => {
    const now = Date.now();
    const currentLastPongTs = pongState.lastPongTs();
    if (now - currentLastPongTs > HEALTH_TIMEOUT) {
      logger.warn(
        `Health timeout exceeded (${HEALTH_TIMEOUT}ms) - terminating connection`
      );
      ws.terminate();
    }
  }, 5000);  // Check every 5 seconds
}
```

### Costanti

```javascript
// client/tunnelClient.js

PING_INTERVAL     = 30 * 1000  // 30 secondi - Livello WebSocket
APP_PING_INTERVAL = 20 * 1000  // 20 secondi - Livello Application
PONG_WAIT        = 10 * 1000  // 10 secondi - Attesa risposta ping
HEALTH_TIMEOUT  = 45 * 1000  // 45 secondi - Timeout salute
```

### Messaggio Application Ping

```javascript
// Formato messaggio ping applicativo:
{
  type: 'ping',    // Tipo messaggio
  seq: 0,         // Numero sequenza (incrementa ogni ping)
  ts: 1714300000000 // Timestamp (Date.now())
}

// Formato messaggio pong:
{
  type: 'pong',
  seq: 0,         // Corrisponde al seq del ping
  ts: 1714300000000 // Timestamp originale
}
```

### Message Type

```javascript
// client/utils.js
const MESSAGE_TYPE_APP_PING = 0x03;  // Application-level ping
const MESSAGE_TYPE_APP_PONG = 0x04; // Application-level pong
```

---

## Comparazione dei due livelli

| Aspect | Protocol (WS) | Application (Data) |
|--------|--------------|-------------------|
| **Livello** | TCP (WebSocket protocol) | Application (messaggio) |
| **Frequenza** | 30 secondi | 20 secondi |
| **Direzione** | Server → Client | Bidirezionale |
| **Tipo** | Frame binario ws | Messaggio nel flusso dati |
| **Timeout** | 30 secondi | 45 secondi (health) |
| **Risposta** | ws.pong() automatic/manual | Messaggio applicativo |
| **Scopo** | Keep-alive TCP | Verify data flow |

---

## Timeline completa della connessione

```
Time    Server (Protocol)              Client (Protocol)       Client (App)
0s     CONNECTED                           │                    │
        │                                 │                    │
        [isAlive = true]                  │                    │
                                           │                    │
                                           ▼                    ▼
                                   APP_PING (seq=0) ──────────────────►
        │                                 │                    │
                                           │              APP_PONG (seq=0) ◄────────
        │                                 │                    │
20s     WS_PING ◄───────────────────────────────────────────│──► WS_PONG
        │                                 │                    │
        [isAlive = false ─► ping sent]     │                    │
                                           │                    │
                                           ▼                    ▼
        [isAlive = true] <── PONG          │               APP_PING (seq=1) ────►
                                           │                    │
                                           │                    │
30s     WS_PING ◄───────────────────────────────────────────│──► WS_PONG
        │                                 │                    │
        [isAlive = false ─► ping sent]     │                    │
                                           │                    │
                                           ▼                    ▼
        [isAlive = true] <── PONG          │               APP_PING (seq=2) ────►
                                           │                    │
...                                              ...
                                           │                    │
45s    [se nessun pong app] ───────────────► ws.terminate()    │
         (Health timeout exceeded)          │                    │
                                           │                    ▼
                                           │              reconnect loop...
```

---

## Scenari di fallimento

### Scenario 1: Server non riceve pong (protocollo)

```
PROBLEMA: Server invia ping, client non risponde

LOG:
  [warn] No pong received from client on tunnel [id], terminating.
  
CAUSA: 
  - Client non gestisce eventi ping
  - Firewall blocca frame pong
  - NAT timeout

FIX:
  ws.on('ping', () => ws.pong());
```

### Scenario 2: Client non riceve pong (applicativo)

```
PROBLEMA: Client invia app ping, server non risponde

LOG:
  [warn] Health timeout exceeded
  
CAUSA:
  - Server crash
  - Connessione TCP degradata
  - Messaggi persi

FIX:
  - Health monitor controlla lastPongTs
  - Auto-reconnect
```

### Scenario 3: TCP server port in uso (EADDRINUSE)

```
PROBLEMA: TCP server (port 8083) non rilasciato alla riconnessione

LOG:
  [error] TCP server error on port 8083: listen EADDRINUSE: address already in use

CAUSA:
  - TCP server non chiuso correttamente
  - Riconnessione rapida prima del cleanup OS

FIX:
  - Cleanup esplicito del TCP server prima di reconnettere
  - Use setImmediate() o wait per cleanup
```

---

## Riconoscimento nei log

### Livello Protocol (WebSocket)

```
# Server invia ping:
[trace] Ping sent to client on tunnel [uuid]

# Client risponde (se gestito):
[trace] Received server ping, sending pong
[pong evento]

# Server riceve pong:
[debug] Pong received from client on tunnel [uuid]

# Timeout - nessun pong:
[warn] No pong received from client on tunnel [uuid], terminating.
```

### Livello Application

```
# Client invia app ping:
[trace] App ping sent: seq=0

# Server risponde app pong:
[trace] App pong received: seq=0

# Health timeout:
[warn] Health timeout exceeded (45000ms) - terminating connection
```

---

## Fix necessari

### 1. Risposta ai ping del server (CRITICO)

```javascript
// client/tunnelClient.js - DOPO la connessione ws

ws.on('open', () => {
  // ... existing code ...
  
  // AGGIUNGERE: Rispondere ai ping del server
  ws.on('ping', () => {
    logger.trace('Received server ping, responding with pong');
    ws.pong();
  });
});
```

### 2. Cleanup TCP server (importante)

```javascript
// server/tcpServer.js o messageHandler.js

// Alla disconnessione, pulire esplicitamente:
function cleanupTunnel(tunnelId, portKey) {
  const tcpServer = state[portKey]?.tcpServers?.[tunnelId];
  if (tcpServer) {
    tcpServer.close(() => {
      delete state[portKey].tcpServers[tunnelId];
    });
  }
}
```

---

## Riepilogo

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARCHITETTURA COMPLETA                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Server                            Client                          │
│  ┌─────────────────┐            ┌─────────────────┐              │
│  │ WS.ping()       │ ─────────► │ ws.pong()       │ ────────OK   │
│  │ (30s interval) │            │ (manual/auto)   │              │
│  └─────────────────┘            └─────────────────┘              │
│                                                                  │
│  ┌─────────────────┐            ┌─────────────────┐              │
│  │ APP_PONG       │ ◄───────── │ APP_PING       │ ────────OK   │
│  │ (20s wait)     │            │ (20s interval) │              │
│  └─────────────────┘            └─────────────────┘              │
│                                                                  │
│  ┌─────────────────────────────────────────┐                   │
│  │ Health Monitor                          │──────► Auto-reconnect    │
│  │ (5s check / 45s timeout)           │                   │
│  └─────────────────────────────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Riferimenti

- [RFC 6455 - The WebSocket Protocol](https://tools.ietf.org/html/rfc6455)
- [ws npm package](https://www.npmjs.com/package/ws)
- File sorgente:
  - `server/websocketServer.js` - Gestione ping server
  - `client/tunnelClient.js` - Gestione ping/client health
  - `server/constants.js` - Costanti timing
  - `client/utils.js` - Costanti message type
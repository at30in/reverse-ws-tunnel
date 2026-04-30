---
date: 2026-04-30
topic: "State Variable Structure"
status: validated
---

# Struttura Completa della Variabile State

## Panoramica

La variabile `state` è un **singleton in-memory** che tiene traccia di tutti i tunnel WebSocket attivi, i server TCP e le connessioni per il reverse tunnel server. Funziona come archivio dati centrale per gestire il ciclo di vita dei tunnel e il routing del traffico.

**Punto di ingresso**: `server/state.js:1` — State viene esportato come oggetto vuoto `module.exports = {}` e popolato dinamicamente da altri moduli.

---

## Struttura Completa

```javascript
state = {
  // Chiave: porta del server WebSocket (es. "443", "8080")
  [wsPort: string]: {
    // Il server WebSocket principale
    webSocketServer: WebSocket.Server,
    
    // Tunnel attivi identificati da tunnelId (UUID)
    websocketTunnels: {
      [tunnelId: string]: {
        // La connessione WebSocket al client tunnel
        ws: WebSocket,
        
        // Connessioni TCP attive per questo tunnel, identificate da UUID
        tcpConnections: {
          [uuid: string]: {
            socket: net.Socket
          }
        },
        
        // Connessioni HTTP (se usate) - stessa struttura di tcpConnections
        httpConnections: {
          [uuid: string]: {
            socket: net.Socket
          }
        }
      }
    },
    
    // Server TCP di ingresso identificati per porta (es. "4443")
    [tcpPort: string]: {
      // Il server TCP in ascolto per connessioni in ingresso
      tcpServer: net.Server
    }
  }
}
```

---

## Schema Visivo

```
state (Object)
│
├── [wsPort: string]                    // Es. "443", "8080"
│   │
│   ├── webSocketServer                  // WebSocket.Server - server WS principale
│   │
│   ├── websocketTunnels (Object)        // Container per tunnel attivi
│   │   │
│   │   └── [tunnelId: string]           // UUID del tunnel
│   │       │
│   │       ├── ws                       // WebSocket - connessione al client
│   │       │
│   │       ├── tcpConnections (Object) // Connessioni TCP attive
│   │       │   │
│   │       │   └── [uuid: string]       // UUID connessione
│   │       │       │
│   │       │       └── socket           // net.Socket
│   │       │
│   │       └── httpConnections (Object) // Connessioni HTTP (se usate)
│   │           │
│   │           └── [uuid: string]
│   │               │
│   │               └── socket           // net.Socket
│   │
│   └── [tcpPort: string]                // Es. "4443" - server TCP di ingresso
│       │
│       └── tcpServer                    // net.Server - server TCP principale
```

---

## Proprietà Chiave per Posizione

| Posizione | Proprietà | Tipo | Descrizione |
|-----------|-----------|------|-------------|
| `websocketServer.js:22` | `state[portKey].webSocketServer` | `WebSocket.Server` | Istanza principale del server WS |
| `websocketServer.js:20` | `state[portKey].websocketTunnels` | `Object` | Container per tunnel attivi |
| `messageHandler.js:49-53` | `state[port].websocketTunnels[tunnelId]` | `Object` | Singolo tunnel con ws + connessioni |
| `messageHandler.js:61-63` | `state[port][tcpPortKey].tcpServer` | `net.Server` | Server TCP per l'ingresso del tunnel |
| `tcpServer.js:49` | `tunnel.tcpConnections[uuid]` | `Object` | Socket TCP per connessione proxy |

---

## Flusso dei Dati

1. **`server/websocketServer.js:16-22`** — Quando `startWebSocketServer()` viene chiamato, inizializza la entry nello state chiavata per porta WebSocket
2. **`server/messageHandler.js:39-66`** — Quando un client invia `MESSAGE_TYPE_CONFIG`, registra il tunnel e avvia un server TCP
3. **`server/tcpServer.js:138`** — Il riferimento al server TCP viene memorizzato nello state per cleanup e gestione

---

## Mutazioni dello State

| File | Azione |
|------|--------|
| `websocketServer.js:19-20` | Inizializza entries dello state all'avvio del server |
| `websocketServer.js:117` | Elimina tunnel quando la connessione si chiude |
| `messageHandler.js:49` | Crea nuova entry per tunnel su messaggio config |
| `tcpServer.js:125` | Rimuove connessione TCP alla chiusura |

---

## Pattern di Gestione State

Questo codebase **NON** usa Redux, Zustand o React Context. Utilizza un semplice **pattern singleton in-memory** — un oggetto JavaScript plain esportato da un modulo e richiesto da altri moduli per condividere state. Questo è un pattern comune in Node.js per mantenere state a livello applicativo senza dipendenze esterne.

---

## Dipendenze Esterne

- **`ws`** — Per istanze `WebSocket.Server`
- **`net`** (Node.js) — Per istanze `net.Server` e `net.Socket`

---

## Note

- Non esiste un'interfaccia TypeScript formale che definisce la struttura dello state. I tipi sono impliciti nel codice.
- La directory `types/` contiene solo interfacce per configurazioni pubbliche (`ClientConfig`, `ServerConfig`), non per lo state interno.
- Lo state parte come oggetto vuoto `{}` e viene popolato lazily man mano che tunnel e server vengono creati.
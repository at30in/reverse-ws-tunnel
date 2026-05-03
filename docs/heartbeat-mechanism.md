# Heartbeat Mechanism: Ping/Pong Protocol

This document explains the two-layer heartbeat mechanism used in the Reverse WebSocket Tunnel to maintain connection health and detect disconnections.

## Overview

The tunnel uses **two parallel heartbeat systems**:

1. **WebSocket-level heartbeat** - Uses native WebSocket ping/pong frames
2. **Application-level heartbeat** - Uses custom message protocol with JSON payloads

Both layers work together to ensure reliable connection monitoring.

---

## Layer 1: WebSocket-Level Heartbeat

### Purpose
Monitor the underlying WebSocket connection at the transport layer.

### Mechanism
- Uses native `ws.ping()` and `ws.on('pong')` WebSocket API
- Server sends ping, client responds with pong
- If pong not received within timeout, connection is terminated

### Configuration (Server)

```javascript
// server/constants.js
const PING_INTERVAL = 1000 * 30; // 30 seconds
const PONG_WAIT = 5000;          // 5 seconds timeout
```

### Server Implementation

```javascript
// server/websocketServer.js
const { PING_INTERVAL } = require('./constants');

function setupHeartbeat(ws, tunnelId) {
  const pongTimeout = setTimeout(() => {
    logger.warn(`No pong received from client on tunnel [${tunnelId}], terminating.`);
    ws.terminate();
  }, PONG_WAIT);

  ws.on('pong', () => {
    clearTimeout(pongTimeout);
    logger.trace(`Pong received from client on tunnel [${tunnelId}]`);
  });

  const pingInterval = setInterval(() => {
    ws.ping();
  }, PING_INTERVAL);

  return { pingInterval };
}
```

### Client Implementation

```javascript
// client/tunnelClient.js
const PING_INTERVAL = 30 * 1000;  // 30s
const PONG_WAIT = 5000;            // 5s

function heartBeat(ws) {
  const pingInterval = setInterval(() => {
    ws.ping();

    const pongTimeout = setTimeout(() => {
      logger.warn('No pong received. Terminating connection.');
      ws.terminate();
    }, PONG_WAIT);

    ws.once('pong', () => {
      clearTimeout(pongTimeout);
    });
  }, PING_INTERVAL);

  return { pingInterval };
}
```

---

## Layer 2: Application-Level Heartbeat

### Purpose
Monitor the application-level tunnel health with sequence-numbered messages that can be tracked end-to-end.

### Mechanism
- Sends custom ping messages with incrementing sequence numbers
- Client responds with pong messages containing the same sequence
- Sequence numbers allow tracking which pings have been acknowledged
- Window of 10 outstanding pings is allowed (to handle network delays)

### Message Types

| Type | Value | Direction | Description |
|------|-------|-----------|-------------|
| `MESSAGE_TYPE_APP_PING` | `0x03` | Server → Client | Ping with sequence number |
| `MESSAGE_TYPE_APP_PONG` | `0x04` | Client → Server | Pong with matching sequence |

### Message Format

```javascript
// Message structure (binary protocol)
[4 bytes: tunnelId length]
[36 bytes: tunnelId]
[4 bytes: uuid length]
[36 bytes: uuid]
[1 byte: message type]
[N bytes: JSON payload]

// Example ping payload
{ "type": "ping", "seq": 5 }

// Example pong payload
{ "type": "pong", "seq": 5 }
```

### Server Implementation

```javascript
// server/messageHandler.js
const MESSAGE_TYPE_APP_PING = 0x03;

function handleAppPing(payload, tunnelId, uuid, ws) {
  const pingData = JSON.parse(payload.toString());
  const pongData = JSON.stringify({
    type: 'pong',
    seq: pingData.seq
  });

  const pongMessage = buildMessageBuffer(
    tunnelId,
    uuid,
    MESSAGE_TYPE_APP_PONG,
    pongData
  );

  ws.send(pongMessage);
  logger.trace(`App pong sent: seq=${pingData.seq} for tunnel ${tunnelId}`);
}
```

### Client Implementation

```javascript
// client/tunnelClient.js
const APP_PING_INTERVAL = 20 * 1000; // 20 seconds

let pingSeq = 0;
let lastPongTs = 0;

function startAppHeartbeat(ws, tunnelId) {
  const interval = setInterval(() => {
    pingSeq++;
    const pingData = JSON.stringify({
      type: 'ping',
      seq: pingSeq
    });

    const message = buildMessageBuffer(
      tunnelId,
      uuidv4(),
      MESSAGE_TYPE_APP_PING,
      pingData
    );

    ws.send(message);
    logger.trace(`App ping sent: seq=${pingSeq}`);
  }, APP_PING_INTERVAL);

  return interval;
}

function handleAppPong(payload) {
  const pongData = JSON.parse(payload.toString());

  // Accept pong if seq is within window of current pingSeq
  if (pongData.seq >= pingSeq - 10) {
    lastPongTs = Date.now();
    logger.trace(`App pong received: seq=${pongData.seq}`);
  } else {
    logger.debug(`Ignoring old pong: seq=${pongData.seq}`);
  }
}
```

---

## Timing Comparison

| Heartbeat Type | Interval | Timeout | Purpose |
|---------------|-----------|---------|---------|
| WebSocket ping | 30s | 5s | Transport layer health |
| App ping | 20s | N/A (tracked via seq) | Application layer health |

The application-level heartbeat runs more frequently (20s vs 30s) to provide faster detection of issues at the tunnel level.

---

## Health Monitoring

The client also includes a health monitor that checks if pong responses are being received:

```javascript
// client/tunnelClient.js
function startHealthMonitor(ws, pongState) {
  setInterval(() => {
    const timeSinceLastPong = Date.now() - pongState.lastPongTs();

    if (timeSinceLastPong > 45000) { // 45 seconds
      logger.warn('No pong received for 45 seconds, terminating.');
      ws.terminate();
    }
  }, 5000);
}
```

This provides an additional safety net - if no pong is received for 45 seconds, the connection is terminated.

---

## Logging

Enable debug logging to see heartbeat activity:

```bash
LOG_LEVEL=debug
```

Expected log patterns:
- `debug: Pong received from client on tunnel [xxx]` - WebSocket pong received
- `trace: App ping sent: seq=N` - Application ping sent
- `trace: App pong received: seq=N` - Application pong received
- `warn: No pong received for 45 seconds, terminating.` - Connection timeout

---

## Troubleshooting

### Symptoms
- Connection drops unexpectedly
- "No pong received" warnings in logs
- High latency or timeouts

### Causes
1. **Network issues** - Firewall, NAT, or network segmentation blocking WebSocket
2. **Client not responding** - Client process hung or overloaded
3. **Timeout too short** - For high-latency networks, increase PONG_WAIT

### Debug Steps
1. Check logs for ping/pong activity
2. Verify network connectivity between server and client
3. Monitor for pattern: ping sent but no pong received
4. Check client-side logs for any errors
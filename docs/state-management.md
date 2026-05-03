# State Management

This document describes the state structure used by the Reverse WebSocket Tunnel server to manage WebSocket connections, TCP servers, and tunnel metadata.

## Overview

The state is a central data structure that tracks all active tunnels, TCP servers, and WebSocket connections. It is organized in two main levels:

1. **Per-Port State** - State keyed by WebSocket server port
2. **Global TCP Server Registry** - Global registry of all TCP servers

## State Structure

### Per-Port State (`state[portKey]`)

Each WebSocket server port has its own state object:

```javascript
{
  "4443": {
    webSocketServer: <WebSocket.Server>,
    websocketTunnels: {
      "<tunnelId>": {
        ws: <WebSocket>,
        tcpConnections: {
          "<uuid>": {
            socket: <net.Socket>
          }
        },
        httpConnections: {}
      }
    },
    "3032": {
      tcpServer: <net.Server>
    }
  }
}
```

#### Components

| Key | Type | Description |
|-----|------|-------------|
| `webSocketServer` | `WebSocket.Server` | The main WebSocket server instance for this port |
| `websocketTunnels` | `Object` | Map of active tunnel connections, keyed by tunnel ID |
| `websocketTunnels[tunnelId].ws` | `WebSocket` | The WebSocket connection for this tunnel |
| `websocketTunnels[tunnelId].tcpConnections` | `Object` | Map of active TCP connections within this tunnel |
| `websocketTunnels[tunnelId].tcpConnections[uuid].socket` | `net.Socket` | TCP socket for forwarding data |
| `"3032"` (example) | `Object` | Per-port-key entry for TCP server on port 3032 |
| `"3032".tcpServer` | `net.Server` | The TCP server listening on port 3032 |

### Global TCP Server Registry (`state.tcpServers`)

A global registry that tracks all TCP servers regardless of which WebSocket port they belong to:

```javascript
{
  "3032": <net.Server>,
  "4444": <net.Server>
}
```

This registry serves as a fallback to ensure TCP servers can be properly cleaned up even if the per-port state has been removed or reset.

## State Lifecycle

### Initialization

When `startWebSocketServer()` is called, the state is initialized:

```javascript
state[portKey] = {
  websocketTunnels: {},
  webSocketServer: new WebSocket.Server({...})
};
```

### Tunnel Registration

When a client connects and sends a `MESSAGE_TYPE_CONFIG` message:

1. A new entry is created in `websocketTunnels[tunnelId]`
2. A TCP server is created for the `TUNNEL_ENTRY_PORT`
3. The TCP server is stored in both:
   - Per-port state: `state[portKey][portKey].tcpServer`
   - Global registry: `state.tcpServers[portKey]`

### Connection Handling

When data flows through the tunnel:

- TCP connections are tracked in `websocketTunnels[tunnelId].tcpConnections`
- Each connection has a unique UUID for identification

### Cleanup (stopWebSocketServer)

When `stopWebSocketServer()` is called:

1. Close all TCP servers in per-port state
2. Close all TCP servers in global registry
3. Close the WebSocket server
4. Delete the per-port state entry
5. Clear the global TCP server registry

## Important Notes

### State Reset Issue

When Node-RED reloads a node, the module cache may be cleared, causing `state` to be re-initialized as an empty object `{}`. This can cause:

- Loss of TCP server references
- Inability to clean up servers on port restart
- `EADDRINUSE` errors when reconnecting

**Solution**: The global TCP server registry (`state.tcpServers`) provides a fallback mechanism. Even if the per-port state is lost, the global registry can be used to track and close TCP servers.

### Port Reuse

The TCP server uses `reuseAddr: true` to allow quick port reuse after server restart:

```javascript
server.listen({
  port: port,
  host: '0.0.0.0',
  reuseAddr: true,
});
```

This helps with scenarios where the previous server is in `TIME_WAIT` state.

## Debugging

Enable debug logging to trace state changes:

```bash
LOG_LEVEL=debug
```

Or in code:

```javascript
setLogLevel('debug');
```

Look for log entries with `[TCP]` and `[CLEANUP]` prefixes for TCP server operations.
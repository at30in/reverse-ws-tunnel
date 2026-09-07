# 🚀 Reverse WebSocket Tunnel

**A Node.js library for creating secure reverse tunnels over WebSocket connections.**

[![Version](https://img.shields.io/npm/v/@remotelinker/reverse-ws-tunnel.svg)](https://www.npmjs.com/package/@remotelinker/reverse-ws-tunnel)
[![License](https://img.shields.io/npm/l/@remotelinker/reverse-ws-tunnel.svg)](LICENSE)



## 📖 What is Reverse WebSocket Tunnel?

Reverse WebSocket Tunnel is a library that enables you to expose local services to the internet through a WebSocket tunnel, similar to tools like ngrok or localtunnel. It consists of two main components:

- **Server**: Runs on a publicly accessible server and accepts WebSocket connections from clients
- **Client**: Runs locally and creates a tunnel to expose local services through the server

### Use Cases

- **Development**: Expose local development servers for testing webhooks, APIs, or sharing work
- **IoT & Edge**: Connect devices behind NAT/firewalls to cloud services
- **Microservices**: Enable secure communication between services across different networks
- **CI/CD**: Create temporary endpoints for automated testing

### How It Works

1. The **server** listens for WebSocket connections and HTTP requests
2. The **client** connects to the server via WebSocket and registers a tunnel ID
3. When the server receives HTTP requests for a specific tunnel, it forwards them through the WebSocket to the client
4. The client proxies the requests to the local target service and sends responses back through the tunnel

---

## ✨ v1.2.0 - Server-to-Client Commands

### ✨ New Features
- **Server-to-client command messaging**: Server can send fire-and-forget commands to connected tunnel agents via `MESSAGE_TYPE_COMMAND` (0x06). Client emits `command` event with `{command, args}` payload.
- **HTTP REST API for commands**: `createHttpApi(wsPort, apiPort)` starts an HTTP server exposing `POST /api/tunnel/command` endpoint for remote command delivery.
- **`sendCommand(wsPort, tunnelId, command, args)`**: Exported function to send commands programmatically from server code.
- **Client events centralized**: New `client/events.js` module with `CLIENT_EVENTS` constants.
- **Server version in CONFIG response**: Server sends `MESSAGE_TYPE_CONFIG_RESPONSE` (0x05) with `serverVersion` after processing CONFIG. Client emits `serverVersion` event.

### 🔧 Improvements
- **Test suite**: 32 suites, 224 tests (was 219)
- **Examples**: Updated server and client examples with command handling

---

## ✨ v1.1.0 - Stability & Reliability

### 🐛 Bug Fixes
- **bodyCoalescer zombie timer**: Prevented zombie timers keeping event loop alive after cleanup
- **forceClosePort takeover leak**: Leaked takeover servers on EADDRINUSE are now closed
- **Logger watcher cleanup**: File watchers are properly removed before creating new ones
- **backpressureSender double-destroy**: `destroy()` is now idempotent — no double-close of socket
- **cleanup try/finally**: WS close always runs even if TCP teardown throws
- **ws.send readyState guard**: APP_PING checks socket is OPEN before sending
- **harness await stopWebSocketServer**: Integration harness awaits port cleanup
- **proxyServer double-close**: Checks `server.listening` before close to prevent EADDRINUSE
- **pong listener accumulation**: Removes old pong listener before registering new heartbeat cycle
- **CONFIG/DATA frame ordering**: WebSocket message handler is now async — CONFIG completes before DATA is processed
- **Duplicate cleanup destroys existing tunnel (KNOWN-012)**: `cleanup()` now checks WebSocket ownership before tearing down TCP connections — rejected duplicates no longer destroy the existing tunnel's resources
- **TCP idle timeout removed (KNOWN-013)**: `socket.setTimeout()` removed from both client-side target sockets and server-side entry sockets. Timeouts caused false-positive destruction of legitimate slow-responding services (e.g. SAP Business One). Dead connection detection now relies on TCP error/close events, WS heartbeat, and stream health checks.
- **Stream health monitoring (KNOWN-014)**: Client heartbeat force-destroys TCP streams stalled longer than the idle timeout with an empty WebSocket buffer.

### 🔧 Improvements
- **Test suite**: 32 suites, 219 tests (was 20 suites, 122 tests)
- **STABILITY_CONTRACT.md**: All RWT-KNOWN issues resolved, all RWT-* invariants covered by regression tests

---

## ✨ v1.0.10 - Previous Release

### 🔧 Code Quality & Developer Experience
- **Code Cleanup**: Removed unused constants and redundant variables
- **Input Validation**: Added tunnelId validation for incoming messages
- **Code Formatting**: Added Prettier configuration for consistent code style
- **Test Suite**: Reorganized tests, removed obsolete files, added new test coverage

---

## ✨ v1.0.9 - Previous Release

### 🐛 Bug Fixes
- **Message Format Standardization**: Fixed inconsistent message formats between server components
- **Ping/Pong Reliability**: Resolved issues with application-level heartbeat failing during data transfer
- **Connection Stability**: Improved connection handling and reduced timeout issues

### 🔧 Technical Improvements
- **Unified Message Protocol**: All server messages now use consistent `buildMessageBuffer` format
- **Simplified Client Architecture**: Removed hybrid parsing logic for better maintainability
- **Enhanced Buffer Management**: Improved message buffering and parsing reliability

---

## 📦 Installation

```bash
npm install @remotelinker/reverse-ws-tunnel
```

## 📦 Module Compatibility

This library supports both **CommonJS** (`require()`) and **ES Modules** (`import`) for maximum compatibility, and includes **full TypeScript support**:

### CommonJS (Traditional)
```javascript
const { startClient } = require('@remotelinker/reverse-ws-tunnel/client');
const { startWebSocketServer } = require('@remotelinker/reverse-ws-tunnel/server');
const { loadConfig } = require('@remotelinker/reverse-ws-tunnel/utils');
```

### ES Modules (Modern)
```javascript
import { startClient } from '@remotelinker/reverse-ws-tunnel/client';
import { startWebSocketServer } from '@remotelinker/reverse-ws-tunnel/server';
import { loadConfig } from '@remotelinker/reverse-ws-tunnel/utils';
```

### TypeScript
```typescript
import { startClient } from '@remotelinker/reverse-ws-tunnel/client';

// Full type safety with IntelliSense
const client = startClient({
  tunnelId: 'uuid',
  wsUrl: 'wss://example.com/tunnel',
  targetUrl: 'http://localhost:3000',
  tunnelEntryPort: 4443
});

// Typed event handlers
client.on('connected', () => console.log('Connected!'));
```

## 🚀 Quick Start

### Server Setup

**CommonJS:**
```javascript
const { startWebSocketServer } = require('@remotelinker/reverse-ws-tunnel/server');
```

**ES Modules:**
```javascript
import { startWebSocketServer } from '@remotelinker/reverse-ws-tunnel/server';
```

```javascript
// Start the WebSocket tunnel server
startWebSocketServer({
  port: 443,
  host: '0.0.0.0',
  path: '/tunnel',
  tunnelIdHeaderName: 'x-tunnel-id',
});
```

### Client Setup

**CommonJS:**
```javascript
const { startClient } = require('@remotelinker/reverse-ws-tunnel/client');
```

**ES Modules:**
```javascript
import { startClient } from '@remotelinker/reverse-ws-tunnel/client';
```

```javascript
// Connect to the tunnel server and expose local service
const client = startClient({
  tunnelId: '1cf2755f-c151-4281-b3f0-55c399035f87',
  wsUrl: 'wss://yourdomain.com/tunnel',
  targetUrl: 'http://localhost:3000',
  tunnelEntryPort: 4443,
  allowInsicureCerts: false,
});

// Listen for events
client.on('connected', () => {
  console.log('Connected to tunnel');
});

client.on('disconnected', () => {
  console.log('Disconnected from tunnel');
});

client.on('command', ({ command, args }) => {
  console.log(`Received command: ${command}`, args);
});

client.on('serverVersion', (version) => {
  console.log(`Server version: ${version}`);
});

// Close connection
// client.close();
```

---

## ⚙️ Configuration

You can configure the library using:

1. **Environment variables**
2. **TOML configuration files** (`config.toml`)
3. **Direct JavaScript parameters**

_Configuration priority: JavaScript parameters > config.toml > environment variables_

### 🖥️ Server Configuration

#### JavaScript API

```javascript
// CommonJS
const { startWebSocketServer } = require('@remotelinker/reverse-ws-tunnel/server');

// ES Modules
// import { startWebSocketServer } from '@remotelinker/reverse-ws-tunnel/server';

startWebSocketServer({
  port: 443, // WebSocket server port
  host: '0.0.0.0', // Host to bind (optional)
  path: '/tunnel', // WebSocket path (optional)
  tunnelIdHeaderName: 'x-tunnel-id', // Header name for tunnel identification
});
```

#### Environment Variables

| Variable                | Description               | Default       | Example       |
| ----------------------- | ------------------------- | ------------- | ------------- |
| `WS_PORT`               | WebSocket server port     | `443`         | `8080`        |
| `HOST`                  | Host address to bind      | `undefined`   | `0.0.0.0`     |
| `PATH_URL`              | WebSocket endpoint path   | `undefined`   | `/tunnel`     |
| `TUNNEL_ID_HEADER_NAME` | HTTP header for tunnel ID | `x-tunnel-id` | `x-tunnel-id` |
| `LOG_LEVEL`             | Logging verbosity         | `info`        | `debug`       |

#### TOML Configuration (`config.toml`)

```toml
# WebSocket server configuration
wsPort = 443
host = "0.0.0.0"
path = "/tunnel"
tunnelIdHeaderName = "x-tunnel-id"
```

#### Example Server

```bash
# Run the example server
npm run example:server
```

### 💻 Client Configuration

#### JavaScript API

```javascript
// CommonJS
const { startClient } = require('@remotelinker/reverse-ws-tunnel/client');

// ES Modules
// import { startClient } from '@remotelinker/reverse-ws-tunnel/client';

const client = startClient({
  tunnelId: '1cf2755f-c151-4281-b3f0-55c399035f87', // Unique tunnel identifier (UUID)
  wsUrl: 'wss://example.com/tunnel', // WebSocket server URL
  targetUrl: 'http://localhost:3000', // Local service to expose
  tunnelEntryUrl: 'http://localhost:4443', // Optional: tunnel entry URL
  tunnelEntryPort: 4443, // TCP port for tunnel entry
  allowInsicureCerts: false, // Allow insecure SSL certificates
  headers: {
    // Optional: custom headers
    Authorization: 'Bearer token',
    'X-Custom-Header': 'value',
  },
  autoReconnect: true, // Automatically reconnect on close (default: true)
});

// Event handling
client.on('connected', () => console.log('Tunnel connected'));
client.on('disconnected', () => console.log('Tunnel disconnected'));

// Close the tunnel
// client.close();
```

#### Environment Variables

| Variable               | Description                        | Required | Default | Example                                |
| ---------------------- | ---------------------------------- | -------- | ------- | -------------------------------------- |
| `TUNNEL_ID`            | Unique tunnel identifier (UUID-v4) | ✅       | -       | `1cf2755f-c151-4281-b3f0-55c399035f87` |
| `WS_URL`               | WebSocket server URL               | ✅       | -       | `wss://example.com/tunnel`             |
| `TARGET_URL`           | Local service URL to expose        | ✅       | -       | `http://localhost:3000`                |
| `TUNNEL_ENTRY_URL`     | Tunnel entry point URL             | ❌       | -       | `http://localhost:4443`                |
| `TUNNEL_ENTRY_PORT`    | TCP port for tunnel entry          | ❌       | -       | `4443`                                 |
| `HEADERS`              | Custom headers (JSON string)       | ❌       | -       | `{"Authorization":"Bearer token"}`     |
| `ALLOW_INSICURE_CERTS` | Allow insecure SSL certificates    | ❌       | `false` | `true`                                 |
| `AUTO_RECONNECT`       | Automatically reconnect on close   | ❌       | `true`  | `false`                                |
| `LOG_LEVEL`            | Logging level                      | ❌       | `info`  | `debug`                                |

#### TOML Configuration (`config.toml`)

```toml
# Unique identifier of the tunnel (UUID-v4)
tunnelId = "1cf2755f-c151-4281-b3f0-55c399035f87"

# WebSocket server URL to connect to
wsUrl = "wss://example.com/tunnel"

# Target URL where the traffic will be forwarded
targetUrl = "http://localhost:3000"

# Optional URL for tunnel entry point
tunnelEntryUrl = "http://localhost:4443"

# TCP port to open for incoming tunnel connections
tunnelEntryPort = 4443

# Whether to allow insecure SSL certificates (dev/test only)
allowInsicureCerts = false

# Automatically reconnect on close
autoReconnect = true

# Log verbosity level: error, warn, info, debug, trace
logLevel = "info"

# Custom headers to send with requests
[headers]
Authorization = "Bearer your-token"
X-Custom-Header = "custom-value"
```

#### Example Client

```bash
# Run the example client
npm run example:client
```

### 🔧 Backpressure & Buffering Configuration

The tunnel supports configurable buffer limits for flow control between TCP and WebSocket. These limits prevent memory exhaustion under high load or with slow consumers.

#### Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `RWT_HIGH_WATERMARK` | Pause TCP producer when outstanding bytes reach this | `8388608` (8MB) | `16777216` |
| `RWT_LOW_WATERMARK` | Resume TCP producer when outstanding bytes drop below this | `2097152` (2MB) | `4194304` |
| `RWT_MAX_FRAME_SIZE` | Maximum single frame size on the wire | `1048576` (1MB) | `2097152` |
| `RWT_MAX_BUFFER_PER_STREAM` | Max bytes queued per stream (WS→TCP) | `67108864` (64MB) | `134217728` |
| `RWT_MAX_BUFFER_PER_TUNNEL` | Max bytes queued across all streams of a tunnel | `268435456` (256MB) | `536870912` |
| `RWT_MAX_BUFFER_PER_PROCESS` | Process-wide buffer ceiling (warn-only) | `536870912` (512MB) | `1073741824` |
| `RWT_TCP_IDLE_TIMEOUT_MS` | Stale threshold for stream health check (paused sender + empty WS buffer) | `60000` (60s) | `120000` |

**Defaults support transfers up to 64MB without configuration.** For larger files, increase `RWT_MAX_BUFFER_PER_STREAM` and `RWT_MAX_BUFFER_PER_TUNNEL`.

---

## 🐳 Docker Deployment

### Building the Docker Image

```bash
npm run docker:build
```

### Running with Docker Compose

```bash
npm run docker:deploy
```

The service will start on port 4443 by default.

### Docker Environment Variables

When using Docker, you can pass all the environment variables mentioned above:

```bash
docker run -e TUNNEL_ID=your-uuid -e WS_URL=wss://example.com -e TARGET_URL=http://localhost:3000 remotelinker/reverse-ws-tunnel
```

---

## 📝 Logging

The library uses Winston for logging with configurable levels:

- `error`: Only error messages
- `warn`: Warnings and errors
- `info`: General information (default)
- `debug`: Detailed debugging information
- `trace`: Very verbose output including message traces

Set the log level via:

- Environment variable: `LOG_LEVEL=debug`
- TOML config: `logLevel = "debug"`

### Logger API

The library exports logger functions for advanced control:

```javascript
const { setLogLevel, getLogLevel, setLogContext, getLogContext, logger } = require('@remotelinker/reverse-ws-tunnel/utils');

// Set log level programmatically
setLogLevel('debug');

// Get current log level
const currentLevel = getLogLevel();

// Set context for all log messages (useful for Node-RED)
setLogContext({ nodeId: 'my-node', session: 'abc123' });

// Get current context
const context = getLogContext();

// Use logger directly
logger.info('Custom log message', { custom: 'data' });
```

---

## 🔧 Advanced Usage

### Custom Headers

You can send custom headers with tunnel requests:

```javascript
// Environment variable (JSON string)
process.env.HEADERS = JSON.stringify({
  'Authorization': 'Bearer your-token',
  'X-API-Key': 'your-api-key'
});

// Or in config.toml
[headers]
Authorization = "Bearer your-token"
X-API-Key = "your-api-key"
```

### SSL/TLS Configuration

For development, you might need to allow insecure certificates:

```javascript
startClient({
  // ... other config
  allowInsicureCerts: true, // Only for development!
});
```

### Multiple Tunnels

Each client needs a unique `tunnelId` (UUID-v4). You can run multiple clients with different tunnel IDs to expose multiple services.

---

## 🧪 Examples

The repository includes working examples:

- **Server**: `examples/server/` - Shows how to set up a tunnel server.
- **Client**: `examples/client/` - Shows how to connect and expose a local service.
- **Web Server**: `examples/webserver/` - A minimal target web server.

### Complete Reverse Tunnel Example

This example demonstrates how to set up a complete reverse tunnel to expose a local web server to the internet.

**1. Start the Target Web Server**

First, start the minimal web server that will be the destination of our tunnel. This server will respond with "Hello, World!".

```bash
# Terminal 1: Start the web server
node examples/webserver/webserver-example.js
# Server running on http://localhost:3000/
```

**2. Start the Tunnel Server**

Next, start the tunnel server. This server runs on a publicly accessible machine and listens for WebSocket connections from the tunnel client.

The example server is located in `examples/server/`.

```bash
# Terminal 2: Start the tunnel server
npm run example:server
```

This will start the server using the configuration from `examples/server/config.toml`. By default, it listens on port `3000` for WebSocket connections and port `4443` for public HTTP requests.

**3. Start the Tunnel Client**

Now, start the tunnel client. The client connects to the tunnel server and exposes the local web server.

We need to configure the client to connect to our tunnel server and point to our local web server. The example client configuration is in `examples/client/config.toml`. Let's modify it to match our setup.

**`examples/client/config.toml`**

```toml
# Unique identifier of the tunnel (UUID-v4)
tunnelId = "1cf2755f-c151-4281-b3f0-55c399035f87"

# WebSocket server URL to connect to
wsUrl = "ws://localhost:8080/tunnel"

# Target URL where the traffic will be forwarded
targetUrl = "http://localhost:8080"

# TCP port to open for incoming tunnel connections
tunnelEntryPort = 4443
```

Now, run the client:

```bash
# Terminal 3: Start the tunnel client
npm run example:client
```

**4. Test the Tunnel**

The tunnel is now active. The tunnel server is listening for requests on port `4443` and will forward them to your local web server running on port `8080`.

You can test it by making a `curl` request to the tunnel server's public endpoint, including the `x-tunnel-id` header:

```bash
# Terminal 4: Test the tunnel
curl -X GET http://localhost:8083 -H "x-tunnel-id: 1cf2755f-c151-4281-b3f0-55c399035f87"
```

You should see the "Hello, World!" response from your local web server.

```
Hello, World!
```

---

## 📊 Metrics

The library exports a lightweight in-process metrics registry for monitoring tunnel health.

### Usage

```javascript
const { getMetrics } = require('@remotelinker/reverse-ws-tunnel/utils');

// Get a snapshot of current metrics
const snapshot = getMetrics().snapshot();
console.log(snapshot);
```

### Periodic Logging

```javascript
const { getMetrics } = require('@remotelinker/reverse-ws-tunnel/utils');

// Log metrics every 30 seconds at debug level
getMetrics().startSummaryTimer(30000);

// Stop the timer
getMetrics().stopSummaryTimer();
```

### Snapshot Output

```jsonc
{
  "label": "tunnel",
  "ts": "2026-08-27T14:30:00.000Z",
  "active_tunnels": 2,                    // number of connected tunnels
  "active_tunnel_ids": [                  // list of connected tunnel IDs
    "1cf2755f-c151-4281-b3f0-55c399035f87",
    "a3b4c5d6-e7f8-9012-3456-789012345678"
  ],
  "active_streams": 5,                    // number of active TCP streams
  "bytes_in_total": 12345678,             // total bytes received from tunnels (WS → TCP)
  "bytes_out_total": 98765432,            // total bytes sent to tunnels (TCP → WS)
  "backpressure_events_total": 3,         // number of backpressure pauses
  "buffered_bytes_total": 1024000,        // total bytes currently buffered
  "buffered_bytes_per_tunnel": {          // buffered bytes per tunnel
    "1cf2755f-...": 512000,
    "a3b4c5d6-...": 512000
  },
  "frame_too_large_total": 0,             // rejected oversized frames
  "tunnel_disconnect_total": 12,          // total tunnel disconnects
  "heartbeat_timeout_total": 0,           // heartbeat timeouts
  "event_loop_lag_ms": {                  // event loop latency
    "p50": 0.5,
    "p99": 2.1
  },
  "tunnels_detail": {                     // per-tunnel metadata
    "1cf2755f-c151-4281-b3f0-55c399035f87": {
      "connectedAt": 1693132200000,       // Date.now() when tunnel connected
      "remoteAddress": "192.168.1.10",    // client IP from WS upgrade request
      "streamCount": 3,                   // number of active TCP streams
      "bytesIn": 1234567,                 // bytes received from this tunnel
      "bytesOut": 9876543                 // bytes sent to this tunnel
    },
    "a3b4c5d6-e7f8-9012-3456-789012345678": {
      "connectedAt": 1693132260000,
      "remoteAddress": "10.0.0.5",
      "streamCount": 2,
      "bytesIn": 567890,
      "bytesOut": 4321098
    }
  }
}
```

### Field Reference

| Field | Description |
|-------|-------------|
| `active_tunnels` | Number of currently connected tunnels |
| `active_tunnel_ids` | Array of connected tunnel ID strings |
| `active_streams` | Number of active TCP streams across all tunnels |
| `bytes_in_total` | Total bytes received from tunnels and written to TCP sockets |
| `bytes_out_total` | Total bytes read from TCP sockets and sent to tunnels |
| `backpressure_events_total` | Number of times a TCP producer was paused due to WS backpressure |
| `buffered_bytes_total` | Total bytes currently queued across all streams |
| `buffered_bytes_per_tunnel` | Buffered bytes breakdown by tunnel ID |
| `frame_too_large_total` | Frames rejected for exceeding `RWT_MAX_FRAME_SIZE_BYTES` |
| `tunnel_disconnect_total` | Total number of tunnel disconnects |
| `heartbeat_timeout_total` | Heartbeat timeout events |
| `event_loop_lag_ms.p50` | Median event loop lag in milliseconds |
| `event_loop_lag_ms.p99` | 99th percentile event loop lag in milliseconds |
| `tunnels_detail` | Per-tunnel metadata (see below) |

#### Per-Tunnel Detail

| Field | Description |
|-------|-------------|
| `connectedAt` | `Date.now()` when the tunnel was registered |
| `remoteAddress` | Client IP address from the WebSocket upgrade request |
| `streamCount` | Number of currently active TCP streams for this tunnel |
| `bytesIn` | Total bytes received from this tunnel (WS → TCP direction) |
| `bytesOut` | Total bytes sent to this tunnel (TCP → WS direction) |

---

## 🔔 Server-to-Client Commands

The server can send fire-and-forget commands to connected tunnel agents. Commands are delivered via the WebSocket tunnel and emitted as events on the client.

There are two ways to send commands:

1. **JavaScript API** — call `sendCommand()` programmatically from your server code
2. **HTTP REST API** — send commands via HTTP POST (requires starting the HTTP API server)

---

### Option 1: JavaScript API (`sendCommand`)

Call `sendCommand()` directly from your Node.js server code:

```javascript
const { startWebSocketServer, sendCommand } = require('@remotelinker/reverse-ws-tunnel/server');

startWebSocketServer({ port: 443, host: '0.0.0.0', path: '/tunnel', tunnelIdHeaderName: 'x-tunnel-id' });

// Send a kill command to a specific tunnel
const sent = sendCommand(443, '1cf2755f-c151-4281-b3f0-55c399035f87', 'kill', { signal: 'SIGTERM' });
console.log(sent); // true if tunnel was found and command sent
```

---

### Option 2: HTTP REST API

#### Starting the HTTP API Server

The HTTP API is a separate server that exposes an HTTP endpoint for sending commands. Start it alongside the WebSocket server:

```javascript
const { startWebSocketServer } = require('@remotelinker/reverse-ws-tunnel/server');
const { createHttpApi } = require('@remotelinker/reverse-ws-tunnel/server/httpApi');

// Start WebSocket tunnel server on port 443
startWebSocketServer({ port: 443, host: '0.0.0.0', path: '/tunnel', tunnelIdHeaderName: 'x-tunnel-id' });

// Start HTTP API server on port 3001 (commands are routed to WS server on port 443)
createHttpApi(443, 3001);
```

#### Sending a Command via HTTP

```bash
curl -X POST http://localhost:3001/api/tunnel/command \
  -H "Content-Type: application/json" \
  -d '{"tunnelId":"1cf2755f-c151-4281-b3f0-55c399035f87","command":"kill","args":{"signal":"SIGTERM"}}'
```

**Response:**

- `200 OK` — `{"success":true}` if the tunnel was found and command sent
- `404 Not Found` — `{"error":"Tunnel not found or not connected"}`
- `400 Bad Request` — `{"error":"Missing tunnelId or command"}`

---

### Client Side — Listening for Commands

Regardless of how the command was sent (JS API or HTTP), the client handles it the same way:

```javascript
const { startClient } = require('@remotelinker/reverse-ws-tunnel/client');

const client = startClient({
  tunnelId: '1cf2755f-c151-4281-b3f0-55c399035f87',
  wsUrl: 'wss://example.com/tunnel',
  targetUrl: 'http://localhost:3000',
  tunnelEntryPort: 4443,
});

client.on('command', ({ command, args }) => {
  console.log(`Received command: ${command}`, args);

  if (command === 'kill') {
    console.log(`Exiting with signal ${args.signal || 'SIGTERM'}`);
    process.exit(0);
  }
});
```

---

## ⚠️ Security Considerations

- **Production Use**: Ready for production use
- **SSL/TLS**: Always use secure WebSocket connections (`wss://`) in production
- **Authentication**: Implement proper authentication mechanisms for your tunnels
- **Rate Limiting**: Consider implementing rate limiting on the server side
- **Firewall**: Ensure proper firewall rules are in place

---

## 📄 License

ISC License - see [LICENSE](LICENSE) file for details.

---

## 🤝 Contributing

This project is in active development. Contributions, issues, and feature requests are welcome!

## 📞 Support

For questions and support, please open an issue on the GitHub repository.

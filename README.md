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

## ✨ v1.0.11 - What's New

### ✨ New Features
- **stopWebSocketServer(port)**: Added new function to properly stop and cleanup the WebSocket server
  - Closes all active WebSocket connections (triggering cleanup of heartbeat intervals)
  - Closes all TCP servers registered in state
  - Cleans up state for the specified port
  - Gracefully handles already-stopped servers (no errors)

### 🐛 Bug Fixes
- **Heartbeat cleanup**: Fixed issue where setInterval for heartbeat was not properly cleaned up when server stopped
- **Node-RED integration**: Added cleanup on startup to handle cases where previous deployment didn't cleanup properly
- **TCP server connection hang**: Fixed critical issue where TCP connections would hang indefinitely
  - Removed `pauseOnConnect: true` option from TCP server configuration
  - This option was added in error - it pauses sockets on connect and requires manual `socket.resume()`
  - The fix restores proper connection flow while keeping `reuseAddr: true` for port reuse on restart
- **TCP server port reuse**: Fixed "EADDRINUSE" error when client reconnects after Node-RED restart
  - Now checks if TCP server is actually listening (`server.listening`) before skipping creation
  - Previously only checked if state entry existed, not if server was active
- **TCP server global registry**: Added global tcpServers registry to track TCP servers even when not in state
  - When stopWebSocketServer is called, now closes ALL TCP servers in global registry
  - When creating new TCP server, checks global registry and closes stale servers before creating new one

### 🔧 Improvements
- **Graceful shutdown**: Server now properly releases all resources (ports, memory, intervals) on shutdown
- **State management**: Improved state cleanup to prevent stale entries after server restart

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
| `RWT_TCP_IDLE_TIMEOUT_MS` | Idle timeout for per-request TCP clients | `60000` (60s) | `120000` |

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

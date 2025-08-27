# 🚀 Reverse WebSocket Tunnel

**A Node.js library for creating secure reverse tunnels over WebSocket connections.**

[![Version](https://img.shields.io/npm/v/reverse-ws-tunnel.svg)](https://www.npmjs.com/package/reverse-ws-tunnel)
[![License](https://img.shields.io/npm/l/reverse-ws-tunnel.svg)](LICENSE)

⚠️ **Prototype Stage**: This software is currently in development and not recommended for production use.

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

## 📦 Installation

```bash
npm install reverse-ws-tunnel
```

## 🚀 Quick Start

### Server Setup

```javascript
const { startWebSocketServer } = require('reverse-ws-tunnel/server');

// Start the WebSocket tunnel server
startWebSocketServer({
  port: 443,
  host: '0.0.0.0',
  path: '/tunnel',
  tunnelIdHeaderName: 'x-tunnel-id',
});
```

### Client Setup

```javascript
const { startClient } = require('reverse-ws-tunnel/client');

// Connect to the tunnel server and expose local service
startClient({
  tunnelId: '1cf2755f-c151-4281-b3f0-55c399035f87',
  wsUrl: 'wss://yourdomain.com/tunnel',
  targetUrl: 'http://localhost:3000',
  tunnelEntryPort: 4443,
  allowInsicureCerts: false,
});
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
const { startWebSocketServer } = require('reverse-ws-tunnel/server');

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
const { startClient } = require('reverse-ws-tunnel/client');

startClient({
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
});
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
docker run -e TUNNEL_ID=your-uuid -e WS_URL=wss://example.com -e TARGET_URL=http://localhost:3000 reverse-ws-tunnel
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

- **Server**: `examples/server/` - Shows how to set up a tunnel server
- **Client**: `examples/client/` - Shows how to connect and expose a local service

```bash
# Terminal 1: Start the server
cd examples/server
node server-example.js

# Terminal 2: Start the client
cd examples/client
node client-example.js
```

---

## ⚠️ Security Considerations

- **Production Use**: This is prototype software - use with caution in production
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

# WebSocket Tunneling Cookbook: Building Reverse Tunnels in Node.js

## Overview

This cookbook provides comprehensive examples and technical deep-dives into reverse WebSocket tunneling using the Node.js library. Whether you're a developer exposing local services, a DevOps engineer deploying production tunnels, or an IoT developer connecting edge devices, this guide offers practical implementations and detailed explanations.

## Table of Contents

1. [Quick Start Examples](#quick-start-examples)
2. [Architecture Deep Dive](#architecture-deep-dive)
3. [Communication Protocol](#communication-protocol)
4. [Security Best Practices](#security-best-practices)
5. [Production Deployment](#production-deployment)
6. [Troubleshooting Guide](#troubleshooting-guide)
7. [Advanced Use Cases](#advanced-use-cases)

## Quick Start Examples

### Example 1: Local Development Server Exposure

**Scenario**: You're developing a web app on `localhost:3000` and need to share it with a client for feedback.

**Step 1: Set up your local service**
```bash
# Create a simple Express server
npm init -y
npm install express
```

```javascript
// server.js
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello from my development server!');
});

app.listen(3000, () => {
  console.log('Dev server running on http://localhost:3000');
});
```

**Step 2: Install the tunneling library**
```bash
npm install reverse-ws-tunnel
```

**Step 3: Create tunnel configuration**
```javascript
// tunnel-config.js
const { startClient } = require('reverse-ws-tunnel/client');

const client = startClient({
  tunnelId: '550e8400-e29b-41d4-a716-446655440000', // Generate a UUID
  wsUrl: 'wss://your-tunnel-server.com/tunnel',
  targetUrl: 'http://localhost:3000',
  tunnelEntryPort: 4443
});

client.on('connected', () => {
  console.log('🎉 Tunnel active! Access at: https://your-tunnel-server.com?tunnelId=550e8400-e29b-41d4-a716-446655440000');
});
```

### Example 2: IoT Device Connectivity

**Scenario**: Connect a Raspberry Pi running a sensor service behind NAT to the cloud.

```javascript
// iot-tunnel.js
const { startClient } = require('reverse-ws-tunnel/client');

const client = startClient({
  tunnelId: 'device-001-sensor-data',
  wsUrl: 'wss://iot-gateway.yourcompany.com/tunnel',
  targetUrl: 'http://localhost:8080',
  headers: {
    'Authorization': 'Bearer device-token-123',
    'Device-Type': 'raspberry-pi-4',
    'Sensor-Capabilities': 'temperature,humidity'
  },
  autoReconnect: true
});

client.on('connected', () => {
  console.log('IoT device connected to cloud');
});

client.on('disconnected', () => {
  console.log('Connection lost, auto-reconnecting...');
});
```

### Example 3: API Development with Webhook Testing

**Scenario**: Develop and test webhooks for payment processing.

```javascript
// webhook-tester.js
const { startClient } = require('reverse-ws-tunnel/client');
const express = require('express');

const app = express();
app.use(express.json());

// Webhook endpoint for payment provider
app.post('/webhooks/payments', (req, res) => {
  console.log('Received payment webhook:', req.body);
  res.json({ status: 'processed' });
});

const server = app.listen(3001, () => {
  console.log('Webhook server ready on port 3001');
});

// Create tunnel for webhook testing
const client = startClient({
  tunnelId: 'webhook-test-session-123',
  wsUrl: 'wss://tunnel.stripe-test.com/tunnel',
  targetUrl: 'http://localhost:3001',
  headers: {
    'X-Webhook-Secret': 'whsec_test_secret'
  }
});

client.on('connected', () => {
  console.log('Webhook tunnel active - configure your Stripe dashboard with:');
  console.log('https://tunnel.stripe-test.com/webhooks?tunnelId=webhook-test-session-123');
});
```

## Architecture Deep Dive

### Core Components

The library consists of three main architectural components:

**1. WebSocket Server Component**
- Handles persistent WebSocket connections from clients
- Manages tunnel registration and state
- Routes incoming HTTP requests based on tunnel IDs

**2. Client Component**
- Establishes outbound WebSocket connection
- Proxies local service requests
- Handles connection lifecycle and reconnection

**3. TCP Proxy Layer**
- Receives external HTTP requests
- Forwards requests through WebSocket tunnels
- Manages connection multiplexing

### System Architecture Diagram

```mermaid
architecture-beta
    group internet[Internet]

        service ext[External Client] in internet
        service tcp[TCP Server] in internet

    end

    service ws[WebSocket Server] in internet

    group local[Local Network]

        service proxy[HTTP Proxy] in local
        service target[Target Service] in local
        service client[WebSocket Client] in local

    end

    ext:R -- L:HTTP Request
    tcp:L -- R:Route by tunnel-id
    tcp:R -- L:WS DATA message
    ws:L -- R:Forward to tunnel
    client:R -- L:Receive WS message
    client:R -- L:Forward to proxy
    proxy:L -- R:HTTP to target
    target:R -- L:Response
    proxy:R -- L:TCP data back
    client:R -- L:WS DATA response
    ws:R -- L:Forward to TCP
    tcp:R -- L:HTTP response
    ext:L -- R:Receive response
```

*Reverse tunneling architecture showing request flow from external clients to local services*

## Communication Protocol

### Message Format

The tunneling protocol uses a custom binary message format optimized for efficiency:

```
[4 bytes: length] [36 bytes: tunnel_id] [36 bytes: connection_uuid] [1 byte: type] [payload]
```

**Message Types:**
- **CONFIG (0x01)**: Initial tunnel setup with target URL, ports, and metadata
- **DATA (0x02)**: Bidirectional data transfer for HTTP requests/responses

### Connection Lifecycle

```mermaid
sequenceDiagram
    participant Local as Local Service
    participant Proxy as Client Proxy
    participant WSClient as Client WS
    participant WSServer as Server WS
    participant TCPServer as Server TCP
    participant Ext as External Client

    Note over WSClient,WSServer: 1. Tunnel Establishment
    WSClient->>WSServer: WS Connect + CONFIG message
    WSServer->>WSClient: Acknowledgment

    Note over TCPServer,Ext: 2. External Request
    Ext->>TCPServer: HTTP Request + x-tunnel-id header
    TCPServer->>WSServer: Parse HTTP → WS DATA message

    Note over WSClient,Proxy: 3. Request Forwarding
    WSServer->>WSClient: WS DATA message
    WSClient->>Proxy: TCP data to local proxy
    Proxy->>Local: HTTP request to target service

    Note over Local,WSClient: 4. Response Flow
    Local-->>Proxy: HTTP response
    Proxy-->>WSClient: TCP data
    WSClient-->>WSServer: WS DATA message
    WSServer-->>TCPServer: Forward to TCP socket
    TCPServer-->>Ext: HTTP response
```

*Complete request-response cycle through the tunnel*

## Security Best Practices

### Authentication & Authorization

```javascript
// Secure tunnel with multiple auth methods
const secureClient = startClient({
  tunnelId: 'prod-api-gateway',
  wsUrl: 'wss://secure-tunnel.yourcompany.com/tunnel',
  targetUrl: 'http://localhost:8080',
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJSUzI1NiIs...',
    'X-API-Key': 'sk_prod_1234567890',
    'X-Client-Cert': 'certificate_fingerprint'
  },
  allowInsicureCerts: false // Always false in production
});
```

### SSL/TLS Configuration

**Server-side SSL termination:**
```javascript
const https = require('https');
const { startWebSocketServer } = require('reverse-ws-tunnel/server');

const sslOptions = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.crt'),
  ca: fs.readFileSync('ca.crt')
};

const server = https.createServer(sslOptions);
startWebSocketServer({
  server, // Use existing HTTPS server
  path: '/secure-tunnel'
});
```

### Network Security

- **Firewall Rules**: Restrict WebSocket server access to known client IPs
- **Rate Limiting**: Implement request throttling to prevent abuse
- **Connection Monitoring**: Log and monitor tunnel usage patterns
- **Certificate Pinning**: Pin SSL certificates to prevent MITM attacks

## Production Deployment

### Docker Compose Setup

```yaml
# docker-compose.yml
version: '3.8'
services:
  tunnel-server:
    image: reverse-ws-tunnel:latest
    ports:
      - "443:443"
      - "80:80"
    environment:
      - WS_PORT=443
      - HOST=0.0.0.0
      - TUNNEL_ID_HEADER_NAME=x-tunnel-id
      - LOG_LEVEL=info
    volumes:
      - ./ssl:/app/ssl:ro
      - ./config:/app/config:ro
    restart: unless-stopped

  tunnel-client:
    image: reverse-ws-tunnel:latest
    environment:
      - TUNNEL_ID=prod-service-001
      - WS_URL=wss://tunnel.yourdomain.com/tunnel
      - TARGET_URL=http://host.docker.internal:3000
      - LOG_LEVEL=debug
    depends_on:
      - tunnel-server
    restart: unless-stopped
```

### Kubernetes Deployment

```yaml
# tunnel-server-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tunnel-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: tunnel-server
  template:
    metadata:
      labels:
        app: tunnel-server
    spec:
      containers:
      - name: tunnel-server
        image: reverse-ws-tunnel:latest
        ports:
        - containerPort: 443
        env:
        - name: WS_PORT
          value: "443"
        - name: LOG_LEVEL
          value: "info"
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 443
            scheme: HTTPS
          initialDelaySeconds: 30
          periodSeconds: 10
```

### Monitoring & Observability

```javascript
// Monitoring integration
const client = startClient({
  // ... config
});

client.on('connected', () => {
  // Send metrics to monitoring system
  prometheusGauge.set({ tunnel_id: config.tunnelId }, 1);
});

client.on('disconnected', () => {
  prometheusGauge.set({ tunnel_id: config.tunnelId }, 0);
});

// Custom metrics collection
setInterval(() => {
  const metrics = {
    tunnelId: config.tunnelId,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    activeConnections: getActiveConnectionCount()
  };

  sendToMonitoring(metrics);
}, 30000);
```

## Troubleshooting Guide

### Common Issues

**Connection Refused**
```bash
# Check if server is running
curl -I https://your-tunnel-server.com/tunnel

# Verify WebSocket connectivity
wscat -c wss://your-tunnel-server.com/tunnel
```

**SSL Certificate Errors**
```javascript
// For development only
const client = startClient({
  // ... config
  allowInsicureCerts: true, // Remove in production
  rejectUnauthorized: false
});
```

**Tunnel Not Receiving Traffic**
```bash
# Test with curl
curl -H "x-tunnel-id: your-tunnel-id" \
     https://your-tunnel-server.com/

# Check server logs for routing errors
docker logs tunnel-server
```

**Connection Drops**
```javascript
// Implement reconnection logic
const client = startClient({
  // ... config
  autoReconnect: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 10
});

client.on('disconnected', (reason) => {
  console.log('Disconnected:', reason);
  // Implement exponential backoff
});
```

### Debug Logging

```javascript
// Enable detailed logging
process.env.LOG_LEVEL = 'debug';

// Or programmatically
const { setLogLevel } = require('reverse-ws-tunnel/utils');
setLogLevel('trace');
```

## Advanced Use Cases

### Load Balancing Multiple Instances

```javascript
// Load balancer configuration
const clients = [];

for (let i = 0; i < 3; i++) {
  const client = startClient({
    tunnelId: `api-server-${i}`,
    wsUrl: 'wss://load-balancer.com/tunnel',
    targetUrl: `http://api-server-${i}:3000`,
    headers: {
      'X-Instance-ID': i,
      'X-Load-Balancer': 'round-robin'
    }
  });

  clients.push(client);
}

// Health check monitoring
clients.forEach((client, index) => {
  client.on('connected', () => {
    console.log(`Instance ${index} connected`);
  });
});
```

### Custom Authentication Middleware

```javascript
// Server-side auth validation
const { startWebSocketServer } = require('reverse-ws-tunnel/server');

const authenticateTunnel = (headers) => {
  const token = headers['authorization'];
  if (!token) return false;

  // Validate JWT token
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.role === 'tunnel-client';
  } catch (err) {
    return false;
  }
};

startWebSocketServer({
  port: 443,
  authenticate: authenticateTunnel
});
```

### WebSocket Upgrade Handling

```javascript
// Handle WebSocket connections through tunnel
const WebSocket = require('ws');
const { startClient } = require('reverse-ws-tunnel/client');

const client = startClient({
  tunnelId: 'websocket-service',
  wsUrl: 'wss://tunnel.com/tunnel',
  targetUrl: 'http://localhost:8080'
});

// The tunnel automatically handles WebSocket upgrades
// No additional configuration needed for WS connections
```

### File Upload/Download Tunneling

```javascript
// Large file transfer configuration
const client = startClient({
  tunnelId: 'file-transfer-service',
  wsUrl: 'wss://tunnel.com/tunnel',
  targetUrl: 'http://localhost:3000',
  // Increase buffer sizes for large files
  maxPayloadSize: '100MB',
  timeout: 300000 // 5 minutes
});

// Server-side file handling
const express = require('express');
const multer = require('multer');
const app = express();

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

app.post('/upload', upload.single('file'), (req, res) => {
  res.json({ message: 'File uploaded successfully' });
});
```

## Performance Optimization

### Connection Pooling

```javascript
// Optimize for high-throughput scenarios
const client = startClient({
  tunnelId: 'high-throughput-api',
  wsUrl: 'wss://tunnel.com/tunnel',
  targetUrl: 'http://localhost:3000',
  // Connection pooling settings
  maxConnections: 100,
  keepAlive: true,
  keepAliveTimeout: 60000
});
```

### Compression

```javascript
// Enable compression for text-based content
const compression = require('compression');

app.use(compression({
  level: 6, // Balance between speed and compression
  threshold: 1024 // Only compress responses > 1KB
}));
```

## Conclusion

This WebSocket tunneling library provides a robust, flexible solution for exposing local services to the internet. From simple development workflows to complex production deployments, the examples in this cookbook demonstrate the library's versatility across different use cases.

Key takeaways:
- **Security First**: Always use SSL/TLS and implement proper authentication
- **Monitoring**: Implement comprehensive logging and metrics collection
- **Scalability**: Design for horizontal scaling with load balancing
- **Reliability**: Use auto-reconnection and proper error handling

For more advanced implementations and custom integrations, refer to the library's source code and API documentation.</content>
<parameter name="filePath">cookbook.md
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.2.0] - 2026-09-07

### ✨ New Features
- **Server-to-client command messaging**: Server can now send fire-and-forget commands to connected tunnel agents via `MESSAGE_TYPE_COMMAND` (0x06). Client emits `command` event with `{command, args}` payload.
- **HTTP REST API for commands**: `createHttpApi(wsPort, apiPort)` starts an HTTP server exposing `POST /api/tunnel/command` endpoint for remote command delivery.
- **`sendCommand(wsPort, tunnelId, command, args)`**: Exported function to send commands programmatically from server code.
- **Client events centralized**: New `client/events.js` module with `CLIENT_EVENTS` constants (`CONNECTED`, `DISCONNECTED`, `SERVER_VERSION`, `COMMAND`, `ERROR`).
- **Server version in CONFIG response**: Server now sends `MESSAGE_TYPE_CONFIG_RESPONSE` (0x05) with `serverVersion` after processing CONFIG. Client emits `serverVersion` event.

### 🔧 Improvements
- **TEST suite**: 32 suites, 224 tests (was 222)
- **Server example**: `examples/server/server-example.js` now starts HTTP API and demonstrates `sendCommand()` with kill after 15s
- **Client example**: `examples/client/client-example.js` now handles `command` and `serverVersion` events

## [1.1.0] - 2026-08-26

### ✨ New Features
- **Bounded backpressure system**: Complete flow control for TCP↔WS in both directions
  - `backpressureSender`: TCP→WS with pause/resume (high/low watermark hysteresis)
  - `streamWriteQueue`: WS→TCP bounded FIFO with overflow self-destruct
- **Incremental frame parser**: `FrameParser` replaces `Buffer.concat()` — O(n) memory, no reallocation
- **Configurable limits via env vars**: `RWT_HIGH_WATERMARK`, `RWT_LOW_WATERMARK`, `RWT_MAX_FRAME_SIZE`, `RWT_MAX_BUFFER_PER_STREAM`, `RWT_MAX_BUFFER_PER_TUNNEL`, `RWT_MAX_BUFFER_PER_PROCESS`, `RWT_TCP_IDLE_TIMEOUT_MS`
- **Per-tunnel metrics**: `TunnelMetrics` singleton with `snapshot()`, event loop lag, buffer accounting
- **Per-tunnel monitoring (Level 2)**: `activeTunnels` is now a `Map<string, TunnelInfo>` exposing `connectedAt`, `remoteAddress`, `streamCount`, `bytesIn`, `bytesOut` per tunnel. `snapshot()` includes `active_tunnel_ids` and `tunnels_detail`. `addTraffic()` accepts optional `tunnelId` to update per-tunnel byte counters.
- **Bidirectional CLOSE**: Server and client both send CLOSE on overflow or socket end
- **Chunked TE re-framing**: Fixes `http-parser-js` de-chunking bug where headers were forwarded with `Transfer-Encoding: chunked` but body was already de-chunked
- **stopWebSocketServer(port)**: Added new function to properly stop and cleanup the WebSocket server
  - Closes all active WebSocket connections (triggering cleanup of heartbeat intervals)
  - Closes all TCP servers registered in state
  - Cleans up state for the specified port
  - Gracefully handles already-stopped servers (no errors)

### 🐛 Bug Fixes
- **Wire format compatibility**: Server now rewrites headers and re-chunks body when upstream sends `Transfer-Encoding: chunked`
- **CLOSE handling**: Server now calls `conn.socket.end()` when receiving CLOSE from client (previously only client did this)
- **Frame parser overflow**: `FrameSizeError` thrown before allocation when declared frame size exceeds limit
- **Heartbeat cleanup**: Fixed issue where setInterval for heartbeat was not properly cleaned up when server stopped
- **Node-RED integration**: Added cleanup on startup to handle cases where previous deployment didn't cleanup properly
- **TCP server connection hang**: Removed `pauseOnConnect: true` option — restores proper connection flow while keeping `reuseAddr: true`
- **TCP server port reuse**: Fixed "EADDRINUSE" error when client reconnects — now checks `server.listening` before skipping creation
- **TCP server global registry**: Added global tcpServers registry to track TCP servers even when not in state
- **bodyCoalescer zombie timer (KNOWN-001)**: `makeBodyCoalescer()` now tracks an `active` flag and exposes `cancel()` to prevent zombie timers keeping event loop alive
- **forceClosePort takeover leak (KNOWN-002)**: `forceClosePort()` now calls `takeover.close()` inside the EADDRINUSE handler, preventing leaked takeover servers
- **Logger watcher cleanup (KNOWN-003)**: Logger now tracks `watchedFilePath` and calls `fs.unwatchFile()` before creating a new watcher. Added `dispose()` export for explicit cleanup
- **backpressureSender double-destroy (KNOWN-004)**: `destroy()` is now idempotent — early-return guard prevents double-close of underlying socket and double-invocation of callback
- **cleanup try/finally (KNOWN-005)**: `cleanup()` in websocketServer is wrapped in try/finally so WS close always runs even if TCP teardown throws
- **ws.send readyState guard (KNOWN-006)**: APP_PING handler now checks `ws.readyState === WebSocket.OPEN` before calling `ws.send()`
- **harness await stopWebSocketServer (KNOWN-007)**: Integration harness `close()` now passes `wsPort` to `stopWebSocketServer` and awaits it, ensuring ports are freed before the next test
- **proxyServer double-close (KNOWN-008)**: `proxyServer.close()` now checks `server.listening` before calling `server.close()`, preventing EADDRINUSE on harness teardown
- **pong listener accumulation (KNOWN-009)**: `heartBeat()` now tracks `pongHandler`/`pongTimeout` and calls `ws.removeListener('pong', ...)` before registering a new cycle — no more listener leak on reconnect
- **CONFIG/DATA frame ordering (KNOWN-010)**: `ws.on('message', ...)` in websocketServer is now `async` and each `handleParsedMessage()` is `await`ed, serializing frame dispatch so CONFIG completes before DATA is processed
- **Duplicate cleanup destroys existing tunnel resources (KNOWN-012)**: `cleanup()` now checks WebSocket ownership (`registeredTunnel.ws === ws`) before tearing down TCP connections, unregistering metrics, or deleting tunnel state. Rejected duplicates only clear their own heartbeat interval and terminate their socket.
- **TCP idle timeout removed — slow services support (KNOWN-013)**: `socket.setTimeout()` removed from both client-side target sockets and server-side entry sockets. Timeouts caused false-positive destruction of legitimate slow-responding services (e.g. SAP Business One, response times > 60s). Dead connection detection now relies on TCP error/close events, WS ping/pong heartbeat, and stream health checks. Half-open TCP detection relies on kernel TCP retransmission timeout (~10-15 min on Linux).
- **No stream health monitoring (KNOWN-014)**: Client-side heartbeat now includes a stream health check that force-destroys TCP streams paused for longer than `staleMs` with an empty WebSocket buffer. This detects and recovers from stalled streams that WebSocket-level heartbeat cannot see.
- **CLOSE frame not sent on TCP error/timeout**: Client `on('error')` and `on('timeout')` handlers now send a CLOSE frame to the server before cleanup. Previously, when the target TCP socket got ECONNRESET or idle timeout, the server entry socket hung for up to 60s (v1.1.0) or indefinitely (v1.0.11) because the server was never notified the stream was dead.
- **Server-side onSendError cleanup (KNOWN-013)**: `ensureConn()` in `server/tcpServer.js` now passes an `onSendError` callback to `createBackpressureSender`. When `ws.send()` fails (e.g. ECONNRESET on the WS link), the entry socket is destroyed immediately instead of the error being swallowed.
- **Server-side stream health check (KNOWN-013)**: The server heartbeat in `server/websocketServer.js` now includes a stream health check mirroring the client-side check. Stalled senders (paused + empty WS buffer + no progress for `tcpIdleTimeoutMs`) are force-destroyed with CLOSE frame, preventing indefinite hang.

### 🔧 Improvements
- **Default buffer limits raised**: `maxBufferPerStreamBytes` 8MB → 64MB, `maxBufferPerTunnelBytes` 32MB → 256MB — transfers up to 64MB work without configuration
- **ws.maxBufferedAmount disabled**: `applyWsBufferGuard()` is now a no-op — the ws library's built-in guard destroys sockets too aggressively for large transfers
- **Graceful shutdown**: Server now properly releases all resources (ports, memory, intervals) on shutdown
- **State management**: Improved state cleanup to prevent stale entries after server restart
- **Diagnostics**: New `stream_stall_cleanup_total` metric counter tracks forced stream cleanups; `getLastProgressTs()` added to BackpressureSender
- **Test suite**: 32 suites, 219 tests (was 28 suites, 206 tests)
  - New: `tcpIdleTimeout` (3), `stallRecovery.integration` (2), `closeOnErrorRegression` (2), `serverBackpressureGaps` (3)
  - Integration: `volumes` (100MB, 10×8MB, starvation, slow reader, 60 streams), `resilience` (disconnect+reconnect, FIN propagation), `backpressure` (tiny limits, overflow)

### 📚 Documentation
- Updated `docs/architecture.md`: added sections for FrameParser, backpressureSender, streamWriteQueue, tunnelLimits, tunnelMetrics, bidirectional CLOSE, RWT_* env vars
- Updated `docs/state-management.md`: added sender/queue/stats to tcpConnections structure
- Updated `README.md`: added backpressure configuration section with env var table
- Updated `STABILITY_CONTRACT.md`: all RWT-KNOWN-001 through RWT-KNOWN-014 marked RESOLVED; R3/R4/R6 races eliminated

## [1.0.11] - 2026-05-03

### ✨ New Features
- **stopWebSocketServer(port)**: Added new function to properly stop and cleanup the WebSocket server
  - Closes all active WebSocket connections (triggering cleanup of heartbeat intervals)
  - Closes all TCP servers registered in state
  - Closes the main WebSocket server
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
  - Fixes issue where TCP server created after Node-RED restart wasn't cleaned up because it wasn't in state yet

### 🔧 Improvements
- **Graceful shutdown**: Server now properly releases all resources (ports, memory, intervals) on shutdown
- **State management**: Improved state cleanup to prevent stale entries after server restart

### 🧪 Testing
- Added 6 new test cases for stopWebSocketServer function covering:
  - Stop on non-existent server (no-op)
  - Closing all WebSocket connections
  - Closing all TCP servers
  - Closing main WebSocket server
  - State cleanup
  - Stop on already-stopped server (graceful)

---

## [1.0.10] - 2026-01-31

### 🔧 Code Quality Improvements
- **Removed unused constants**: Eliminated `RECONNECT_INTERVAL` constant that was defined but never used
- **Variable cleanup**: Removed redundant `pingSeq` and `lastPongTs` variables at function scope
- **Connection state management**: Fixed `reconnectAttempt` to properly reset to 0 on successful connection
- **Input validation**: Added `tunnelId` validation for incoming messages to ensure messages match expected tunnel
- **Headers parsing**: Improved headers parsing to handle both string (JSON) and object formats correctly

### 🎨 Development Experience
- **Code formatting**: Added Prettier configuration with consistent formatting rules
- **New npm scripts**: Added `format` and `format:check` scripts for code formatting
- **Formatted codebase**: Applied consistent formatting across all JavaScript files

### 🧪 Testing
- **Removed obsolete tests**: Deleted 7 outdated test files with syntax errors and invalid logic
- **New test suites**: Added `clientHeartbeat.test.js` and `clientMessages.test.js` for better coverage
- **Updated existing tests**: Modified tests to match current code behavior and validation logic

---

## [1.0.9] - 2026-01-24

### 🐛 Bug Fixes
- **Message Format Standardization**: Fixed inconsistent message formats between server components causing parsing errors
- **Ping/Pong Reliability**: Resolved critical issue where application-level heartbeat failed during data transfer
- **Connection Stability**: Fixed client timeouts and disconnections when handling large data flows

### 🔧 Technical Improvements  
- **Unified Message Protocol**: All server messages now use consistent `buildMessageBuffer` format
  - `tcpServer.js` updated to use `buildMessageBuffer` instead of manual concatenation
  - Eliminated mixed format messages (old vs new format confusion)
- **Simplified Client Architecture**: Removed complex hybrid parsing logic
  - Client now uses single, consistent message format with proper buffering
  - Improved reliability and maintainability
- **Enhanced Buffer Management**: Fixed message buffering and parsing reliability issues
  - Proper length prefix handling for all message types
  - Resolved incorrect length reading causing buffer corruption

### 🏗️ Internal Changes
- Standardized all WebSocket message creation across server components
- Simplified client message parsing from dual-format to single-format approach
- Improved error handling and debugging for message parsing failures

---

## [1.0.8] - 2026-01-21

### Features
- Added application-level heartbeat mechanism to detect silent WebSocket closures
- Implemented unidirectional client→server ping-pong (20s intervals, 45s timeout)
- Added sliding window health monitoring with automatic reconnection
- Implemented progressive backoff for reconnections: 1s → 2s → 5s → 10s → 30s max
- Fire-and-forget ping mechanism with monotonic sequence numbers
- Server responds immediately to application ping messages
- Resolves "socket hang up" errors caused by firewall/NAT silent disconnections

### Technical Details
- Added `MESSAGE_TYPE_APP_PING` (0x03) and `MESSAGE_TYPE_APP_PONG` (0x04) message types
- Client sends JSON-formatted ping messages every 20 seconds
- Server responds with pong messages containing same sequence number
- Health monitor checks sliding window of 45 seconds for pong responses
- Automatic WebSocket termination and reconnection when health timeout exceeded

## [1.0.6] - 2026-01-09

### Features
- Added complete TypeScript support with declaration files (.d.ts)
- Added TypeScript type definitions for all exported functions and interfaces
- Added IntelliSense and autocompletion support for TypeScript projects
- Added TypeScript examples and type checking scripts
- Resolved TS7016 error for projects importing the library

## [1.0.5] - 2026-01-09

### Features
- Added dual CommonJS/ESM compatibility
- Implemented conditional exports for both module systems
- Added ESM wrapper files (.mjs) for all modules
- Added root index files for CommonJS (index.cjs) and ESM (index.mjs)
- Updated Jest configuration for dual module support
- Added ESM examples alongside existing CommonJS examples
- Maintained full backward compatibility

### Technical Changes
- Updated package.json with conditional exports
- Renamed jest.config.js to jest.config.cjs
- Added support for both `require()` and `import` statements

## [1.0.4] - 2026-01-09

### Fixes
- Fixed logger colorize issues in unit tests
- Added fallback for undefined log levels in printf format
- Used process.cwd() for default config path in initLogger
- Passed custom colors to winston colorize formatter

## [1.0.3] - 2025-11-29

### Features
- Updated `startClient` to return a client instance.
- Added `connected` and `disconnected` events to the client instance.
- Added `close()` method to the client instance to terminate the connection and stop reconnection.

## [1.0.2] - 2025-10-05

### Fixes
- Corrected a typo in the environment variable name for `allowInsicureCerts` in the client configuration loader.

## [1.0.1] - 2025-09-16

### Features
- Added a comprehensive example of a reverse tunnel to README.md.
- Included a minimal web server to act as the tunnel's target.
- Updated the client configuration to align with the new example.
- Generated a CHANGELOG.md file from the project's git history.

### Refactoring
- Refactored WebSocket connection state management.

## [1.0.0] - 2025-09-16

### Features
- Added dynamic environment configuration.
- Added client IP to server connection function.
- Added support for custom config path.
- Added unit tests with Jest.
- Added `config.toml` for configuration.
- Added logger.
- Added examples.
- Added dynamic allowance of insecure HTTPS certificates.
- Added support for multiple servers on different ports.
- Added return of the WebSocket server instance.
- Added dynamic TCP server.
- Initial working version.

### Fixes
- Fixed WebSocket server heartbeat.
- Fixed `allowInsicureCerts` option.
- Fixed logger path.
- Fixed heartbeat issue.
- Disabled secure proxy when set to false.

### Refactoring
- Refactored dist directory structure.
- Changed `tunnelIdHeaderName`.
- Refactored with ChatGPT suggestions.

---

[1.2.0]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.11...v1.1.0
[1.0.11]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/remoteLinker/reverse-ws-tunnel/releases/tag/v1.0.0

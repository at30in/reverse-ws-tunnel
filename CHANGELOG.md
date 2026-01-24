# Changelog

All notable changes to this project will be documented in this file.

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

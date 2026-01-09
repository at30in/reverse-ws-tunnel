# Changelog

All notable changes to this project will be documented in this file.

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

[1.0.6]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/remoteLinker/reverse-ws-tunnel/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/remoteLinker/reverse-ws-tunnel/releases/tag/v1.0.0

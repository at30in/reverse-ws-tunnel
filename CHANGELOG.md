# Changelog

All notable changes to this project will be documented in this file.

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
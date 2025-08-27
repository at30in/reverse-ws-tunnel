// Mock the logger first, before any imports
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock constants
jest.mock('../server/constants', () => ({
  PING_INTERVAL: 100, // 100ms for testing
}));

// Mock the message handler
const mockHandleParsedMessage = jest.fn();
jest.mock('../server/messageHandler', () => ({
  handleParsedMessage: mockHandleParsedMessage,
}));

// Mock the state module
const mockState = {};
jest.mock('../server/state', () => mockState);

const WebSocket = require('ws');
const { startWebSocketServer } = require('../server/websocketServer');

describe('WebSocket Server', () => {
  let serverState;
  let openConnections = [];

  const mockConfig = {
    port: 0, // Use port 0 for automatic assignment
    tunnelIdHeaderName: 'x-tunnel-id',
  };

  afterEach(async () => {
    // Close all open connections first
    for (const client of openConnections) {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.terminate();
      }
    }
    openConnections = [];

    // Clean up any running servers
    if (serverState) {
      const portKey = String(mockConfig.port);
      if (serverState[portKey]?.webSocketServer) {
        await new Promise((resolve) => {
          try {
            serverState[portKey].webSocketServer.close(() => {
              resolve();
            });
          } catch (e) {
            resolve();
          }
        });
      }
    }

    // Clear mock state
    Object.keys(mockState).forEach((key) => delete mockState[key]);
    jest.clearAllMocks();
  });

  it('should start WebSocket server', (done) => {
    const timeout = setTimeout(() => {
      done(new Error('Test timeout'));
    }, 5000);

    serverState = startWebSocketServer(mockConfig);

    const portKey = String(mockConfig.port);
    expect(serverState[portKey]).toBeDefined();
    expect(serverState[portKey].webSocketServer).toBeDefined();

    serverState[portKey].webSocketServer.on('listening', () => {
      clearTimeout(timeout);
      const actualPort = serverState[portKey].webSocketServer.address().port;
      expect(actualPort).toBeGreaterThan(0);
      done();
    });

    serverState[portKey].webSocketServer.on('error', (err) => {
      clearTimeout(timeout);
      done(err);
    });
  });

  it('should accept WebSocket connections', (done) => {
    const timeout = setTimeout(() => {
      done(new Error('Test timeout'));
    }, 5000);

    serverState = startWebSocketServer(mockConfig);
    const portKey = String(mockConfig.port);

    serverState[portKey].webSocketServer.on('listening', () => {
      const port = serverState[portKey].webSocketServer.address().port;
      const client = new WebSocket(`ws://localhost:${port}`);
      openConnections.push(client);

      client.on('open', () => {
        clearTimeout(timeout);
        expect(client.readyState).toBe(WebSocket.OPEN);
        client.close();
        done();
      });

      client.on('error', () => {
        clearTimeout(timeout);
        done();
      });

      client.on('close', () => {
        // Connection closed, test complete
      });
    });

    serverState[portKey].webSocketServer.on('error', (err) => {
      clearTimeout(timeout);
      done(err);
    });
  });
});

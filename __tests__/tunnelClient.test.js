// Mock the logger first
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock uuid to return predictable values
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234-5678-9012-123456789012'),
}));

// Mock the package.json
jest.mock('../package.json', () => ({
  version: '1.0.0-test',
}));

// Mock net module
const mockTcpSocket = {
  on: jest.fn(),
  write: jest.fn(() => true),
  destroy: jest.fn(),
  end: jest.fn(),
  once: jest.fn(),
};

jest.mock('net', () => ({
  createConnection: jest.fn(() => mockTcpSocket),
}));

const WebSocket = require('ws');
const { connectWebSocket } = require('../client/tunnelClient');

describe('tunnelClient', () => {
  let server;
  let serverPort;
  let openConnections = [];

  const mockConfig = {
    tunnelId: '12345678-1234-1234-1234-123456789abc',
    wsUrl: '',
    targetUrl: 'http://localhost:3000',
    targetPort: 3000,
    tunnelEntryUrl: 'http://localhost:4443',
    tunnelEntryPort: 4443,
    headers: { Authorization: 'Bearer test-token' },
  };

  beforeEach((done) => {
    // Clear all mocks
    jest.clearAllMocks();
    openConnections = [];

    // Create WebSocket test server
    server = new WebSocket.Server({ port: 0 }, () => {
      serverPort = server.address().port;
      mockConfig.wsUrl = `ws://localhost:${serverPort}`;
      done();
    });
  });

  afterEach(async () => {
    // Close all open connections
    for (const client of openConnections) {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.terminate();
      }
    }
    openConnections = [];

    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });

  it('should throw error when tunnelId is missing', () => {
    const configWithoutTunnelId = { ...mockConfig, tunnelId: null };

    expect(() => {
      connectWebSocket(configWithoutTunnelId);
    }).toThrow('Missing mandatory tunnelId');
  });

  it('should connect to WebSocket server and send config message', (done) => {
    const timeout = setTimeout(() => {
      done(new Error('Test timeout'));
    }, 5000);

    server.once('connection', (ws) => {
      openConnections.push(ws);

      ws.once('message', (message) => {
        clearTimeout(timeout);
        expect(Buffer.isBuffer(message)).toBe(true);

        // Parse the message to verify structure
        const length = message.readUInt32BE(0);
        expect(length).toBe(message.length - 4);

        ws.close();
        done();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        done(err);
      });
    });

    try {
      connectWebSocket(mockConfig);
    } catch (err) {
      clearTimeout(timeout);
      done(err);
    }
  });

  it('should handle WebSocket errors gracefully', (done) => {
    const timeout = setTimeout(() => {
      done(new Error('Test timeout'));
    }, 3000);

    server.once('connection', (ws) => {
      openConnections.push(ws);

      // Emit error after connection
      setTimeout(() => {
        ws.emit('error', new Error('WebSocket test error'));
        clearTimeout(timeout);
        done();
      }, 100);
    });

    try {
      connectWebSocket(mockConfig);
    } catch (err) {
      clearTimeout(timeout);
      done(err);
    }
  });
});

describe('tunnelClient', () => {
  let server;
  let serverPort;
  let mockTcpSocket;

  const mockConfig = {
    tunnelId: '12345678-1234-1234-1234-123456789abc',
    wsUrl: '',
    targetUrl: 'http://localhost:3000',
    targetPort: 3000,
    tunnelEntryUrl: 'http://localhost:4443',
    tunnelEntryPort: 4443,
    headers: { Authorization: 'Bearer test-token' },
  };

  beforeEach((done) => {
    // Create mock TCP socket
    mockTcpSocket = {
      on: jest.fn(),
      write: jest.fn(() => true),
      destroy: jest.fn(),
      end: jest.fn(),
      once: jest.fn(),
    };

    net.createConnection.mockReturnValue(mockTcpSocket);

    // Create WebSocket test server
    server = new WebSocket.Server({ port: 0 }, () => {
      serverPort = server.address().port;
      mockConfig.wsUrl = `ws://localhost:${serverPort}`;
      done();
    });
  });

  afterEach((done) => {
    if (server) {
      server.close(() => {
        done();
      });
    } else {
      done();
    }

    // Clear all mocks
    jest.clearAllMocks();
  });

  it('should throw error when tunnelId is missing', () => {
    const configWithoutTunnelId = { ...mockConfig, tunnelId: null };

    expect(() => {
      connectWebSocket(configWithoutTunnelId);
    }).toThrow('Missing mandatory tunnelId');
  });

  it('should connect to WebSocket server and send config message', (done) => {
    server.once('connection', (ws) => {
      ws.once('message', (message) => {
        expect(Buffer.isBuffer(message)).toBe(true);

        // Parse the message to verify structure
        const length = message.readUInt32BE(0);
        expect(length).toBe(message.length - 4);

        // Extract tunnelId
        const tunnelId = message.slice(4, 4 + mockConfig.tunnelId.length).toString();
        expect(tunnelId).toBe(mockConfig.tunnelId);

        done();
      });
    });

    connectWebSocket(mockConfig);
  });

  it('should send correct config payload on connection', (done) => {
    server.once('connection', (ws) => {
      ws.once('message', (message) => {
        // Extract payload from the message
        const tunnelIdLength = mockConfig.tunnelId.length;
        const uuidLength = 36; // UUID v4 length
        const type = message.readUInt8(4 + tunnelIdLength + uuidLength);
        const payload = message.slice(4 + tunnelIdLength + uuidLength + 1);

        expect(type).toBe(0x01); // MESSAGE_TYPE_CONFIG

        const config = JSON.parse(payload.toString());
        expect(config.TARGET_URL).toBe(mockConfig.targetUrl);
        expect(config.TARGET_PORT).toBe(mockConfig.targetPort);
        expect(config.TUNNEL_ENTRY_URL).toBe(mockConfig.tunnelEntryUrl);
        expect(config.TUNNEL_ENTRY_PORT).toBe(mockConfig.tunnelEntryPort);
        expect(config.environment).toBe('production');
        expect(config.agentVersion).toBe('1.0.0-test');

        done();
      });
    });

    connectWebSocket(mockConfig);
  });

  it('should handle data messages and create TCP connections', (done) => {
    const testUuid = 'test-uuid-1234-5678-9012-123456789012';
    const testData = Buffer.from('Hello from server');

    // Mock TCP socket events
    mockTcpSocket.on.mockImplementation((event, callback) => {
      if (event === 'connect') {
        setTimeout(() => callback(), 10);
      }
    });

    server.once('connection', (ws) => {
      // Wait for initial config message
      ws.once('message', () => {
        // Send a data message
        const dataMessage = Buffer.concat([
          Buffer.from(testUuid),
          Buffer.from([0x02]), // MESSAGE_TYPE_DATA
          testData,
        ]);

        ws.send(dataMessage);

        setTimeout(() => {
          expect(net.createConnection).toHaveBeenCalledWith(mockConfig.targetPort, 'localhost');
          expect(mockTcpSocket.write).toHaveBeenCalledWith(testData);
          done();
        }, 50);
      });
    });

    connectWebSocket(mockConfig);
  });

  it('should handle CLOSE messages', (done) => {
    const testUuid = 'test-uuid-close-1234-5678-9012-123456789012';

    mockTcpSocket.on.mockImplementation((event, callback) => {
      if (event === 'connect') {
        setTimeout(() => callback(), 10);
      }
    });

    server.once('connection', (ws) => {
      ws.once('message', () => {
        // Send CLOSE message
        const closeMessage = Buffer.concat([
          Buffer.from(testUuid),
          Buffer.from([0x02]), // MESSAGE_TYPE_DATA
          Buffer.from('CLOSE'),
        ]);

        ws.send(closeMessage);

        setTimeout(() => {
          expect(mockTcpSocket.end).toHaveBeenCalled();
          done();
        }, 50);
      });
    });

    connectWebSocket(mockConfig);
  });

  it('should handle TCP socket backpressure', (done) => {
    const testUuid = 'test-uuid-backpressure-123456789012';
    const testData = Buffer.from('Large data payload');

    // Mock write to return false (backpressure)
    mockTcpSocket.write.mockReturnValue(false);
    mockTcpSocket.on.mockImplementation((event, callback) => {
      if (event === 'connect') {
        setTimeout(() => callback(), 10);
      }
    });

    server.once('connection', (ws) => {
      ws.once('message', () => {
        const dataMessage = Buffer.concat([Buffer.from(testUuid), Buffer.from([0x02]), testData]);

        ws.send(dataMessage);

        setTimeout(() => {
          expect(mockTcpSocket.write).toHaveBeenCalledWith(testData);
          expect(mockTcpSocket.once).toHaveBeenCalledWith('drain', expect.any(Function));
          done();
        }, 50);
      });
    });

    connectWebSocket(mockConfig);
  });

  it('should handle WebSocket errors gracefully', (done) => {
    server.once('connection', (ws) => {
      // Emit error after connection
      setTimeout(() => {
        ws.emit('error', new Error('WebSocket test error'));
        done();
      }, 10);
    });

    connectWebSocket(mockConfig);
  });

  it('should attempt reconnection when WebSocket closes', (done) => {
    jest.useFakeTimers();

    server.once('connection', (ws) => {
      setTimeout(() => {
        ws.close();

        // Fast forward the timer
        jest.advanceTimersByTime(5000);

        // Check if setTimeout was called for reconnection
        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 5000);

        jest.useRealTimers();
        done();
      }, 10);
    });

    connectWebSocket(mockConfig);
  });

  it('should handle malformed headers gracefully', () => {
    const configWithBadHeaders = {
      ...mockConfig,
      headers: null, // This should be handled gracefully
    };

    // Should not throw an error
    expect(() => {
      connectWebSocket(configWithBadHeaders);
    }).not.toThrow();
  });
});

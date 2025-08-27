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

// Mock constants
jest.mock('../server/constants', () => ({
  MESSAGE_TYPE_CONFIG: 0x01,
  MESSAGE_TYPE_DATA: 0x02,
}));

// Mock TCP server
const mockStartTCPServer = jest.fn(() => ({
  listen: jest.fn(),
  close: jest.fn(),
}));
jest.mock('../server/tcpServer', () => ({
  startTCPServer: mockStartTCPServer,
}));

// Mock state
const mockState = {};
jest.mock('../server/state', () => mockState);

const { handleParsedMessage } = require('../server/messageHandler');

describe('Message Handler', () => {
  let mockWebSocket;

  const testConfig = {
    tunnelId: '12345678-1234-1234-1234-123456789abc',
    uuid: 'test-uuid-1234-5678-9012-123456789012',
    tunnelIdHeaderName: 'x-tunnel-id',
    port: '443',
  };

  beforeEach(() => {
    // Reset mocks and state
    jest.clearAllMocks();
    Object.keys(mockState).forEach((key) => delete mockState[key]);

    // Mock WebSocket
    mockWebSocket = {
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1, // OPEN
    };
  });

  it('should handle valid config message', () => {
    const configPayload = Buffer.from(
      JSON.stringify({
        TUNNEL_ENTRY_PORT: 4443,
        TARGET_URL: 'http://localhost:3000',
      })
    );

    expect(() => {
      handleParsedMessage(
        mockWebSocket,
        testConfig.tunnelId,
        testConfig.uuid,
        0x01, // MESSAGE_TYPE_CONFIG
        configPayload,
        testConfig.tunnelIdHeaderName,
        testConfig.port
      );
    }).not.toThrow();

    // Verify TCP server was started
    expect(mockStartTCPServer).toHaveBeenCalledWith(4443, testConfig.tunnelIdHeaderName, testConfig.port);
  });

  it('should handle config message without TUNNEL_ENTRY_PORT', () => {
    const configPayload = Buffer.from(
      JSON.stringify({
        TARGET_URL: 'http://localhost:3000',
        // Missing TUNNEL_ENTRY_PORT
      })
    );

    expect(() => {
      handleParsedMessage(
        mockWebSocket,
        testConfig.tunnelId,
        testConfig.uuid,
        0x01, // MESSAGE_TYPE_CONFIG
        configPayload,
        testConfig.tunnelIdHeaderName,
        testConfig.port
      );
    }).not.toThrow();

    // Should not have started TCP server
    expect(mockStartTCPServer).not.toHaveBeenCalled();
  });

  it('should handle data messages when no tunnel exists', () => {
    const testData = Buffer.from('Test data');

    expect(() => {
      handleParsedMessage(
        mockWebSocket,
        'non-existent-tunnel',
        testConfig.uuid,
        0x02, // MESSAGE_TYPE_DATA
        testData,
        testConfig.tunnelIdHeaderName,
        testConfig.port
      );
    }).not.toThrow();
  });
});

describe('Message Handler', () => {
  let mockWebSocket;
  let mockTcpSocket;

  const testConfig = {
    tunnelId: '12345678-1234-1234-1234-123456789abc',
    uuid: 'test-uuid-1234-5678-9012-123456789012',
    tunnelIdHeaderName: 'x-tunnel-id',
    port: '443',
  };

  beforeEach(() => {
    // Reset mocks and state
    jest.clearAllMocks();
    Object.keys(mockState).forEach((key) => delete mockState[key]);

    // Mock WebSocket
    mockWebSocket = {
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1, // OPEN
    };

    // Mock TCP Socket
    mockTcpSocket = {
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
      on: jest.fn(),
    };
  });

  describe('CONFIG message handling', () => {
    it('should handle valid config message', () => {
      const configPayload = Buffer.from(
        JSON.stringify({
          TUNNEL_ENTRY_PORT: 4443,
          TARGET_URL: 'http://localhost:3000',
          TARGET_PORT: 3000,
        })
      );

      handleParsedMessage(
        mockWebSocket,
        testConfig.tunnelId,
        testConfig.uuid,
        0x01, // MESSAGE_TYPE_CONFIG
        configPayload,
        testConfig.tunnelIdHeaderName,
        testConfig.port
      );

      // Verify state was updated
      expect(mockState[testConfig.port]).toBeDefined();
      expect(mockState[testConfig.port].websocketTunnels).toBeDefined();
      expect(mockState[testConfig.port].websocketTunnels[testConfig.tunnelId]).toBeDefined();
      expect(mockState[testConfig.port].websocketTunnels[testConfig.tunnelId].ws).toBe(mockWebSocket);

      // Verify TCP server was started
      expect(mockStartTCPServer).toHaveBeenCalledWith(4443, testConfig.tunnelIdHeaderName, testConfig.port);
    });

    it('should handle config message without TUNNEL_ENTRY_PORT', () => {
      const configPayload = Buffer.from(
        JSON.stringify({
          TARGET_URL: 'http://localhost:3000',
          TARGET_PORT: 3000,
          // Missing TUNNEL_ENTRY_PORT
        })
      );

      handleParsedMessage(
        mockWebSocket,
        testConfig.tunnelId,
        testConfig.uuid,
        0x01, // MESSAGE_TYPE_CONFIG
        configPayload,
        testConfig.tunnelIdHeaderName,
        testConfig.port
      );

      // Should not have created tunnel due to missing port
      expect(mockStartTCPServer).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON in config message', () => {
      const configPayload = Buffer.from('invalid-json');

      expect(() => {
        handleParsedMessage(
          mockWebSocket,
          testConfig.tunnelId,
          testConfig.uuid,
          0x01, // MESSAGE_TYPE_CONFIG
          configPayload,
          testConfig.tunnelIdHeaderName,
          testConfig.port
        );
      }).not.toThrow();

      // Should not have created tunnel due to invalid JSON
      expect(mockStartTCPServer).not.toHaveBeenCalled();
    });

    it('should reuse existing TCP server for same port', () => {
      // Set up existing TCP server in state
      mockState[testConfig.port] = {
        websocketTunnels: {},
        4443: {
          tcpServer: { existing: true },
        },
      };

      const configPayload = Buffer.from(
        JSON.stringify({
          TUNNEL_ENTRY_PORT: 4443,
          TARGET_URL: 'http://localhost:3000',
        })
      );

      handleParsedMessage(
        mockWebSocket,
        testConfig.tunnelId,
        testConfig.uuid,
        0x01, // MESSAGE_TYPE_CONFIG
        configPayload,
        testConfig.tunnelIdHeaderName,
        testConfig.port
      );

      // Should not start new TCP server
      expect(mockStartTCPServer).not.toHaveBeenCalled();

      // But should still register the tunnel
      expect(mockState[testConfig.port].websocketTunnels[testConfig.tunnelId]).toBeDefined();
    });
  });

  describe('DATA message handling', () => {
    beforeEach(() => {
      // Set up state with existing tunnel and TCP connection
      mockState[testConfig.port] = {
        websocketTunnels: {
          [testConfig.tunnelId]: {
            ws: mockWebSocket,
            tcpConnections: {
              [testConfig.uuid]: {
                socket: mockTcpSocket,
              },
            },
            httpConnections: {},
          },
        },
      };
    });

    it('should forward data to existing TCP connection', () => {
      const testData = Buffer.from('Hello, world!');

      handleParsedMessage(
        mockWebSocket,
        testConfig.tunnelId,
        testConfig.uuid,
        0x02, // MESSAGE_TYPE_DATA
        testData,
        testConfig.tunnelIdHeaderName,
        testConfig.port
      );

      expect(mockTcpSocket.write).toHaveBeenCalledWith(testData);
    });

    it('should handle data for non-existent tunnel', () => {
      const testData = Buffer.from('Test data');
      const nonExistentTunnelId = 'non-existent-tunnel-id';

      expect(() => {
        handleParsedMessage(
          mockWebSocket,
          nonExistentTunnelId,
          testConfig.uuid,
          0x02, // MESSAGE_TYPE_DATA
          testData,
          testConfig.tunnelIdHeaderName,
          testConfig.port
        );
      }).not.toThrow();

      expect(mockTcpSocket.write).not.toHaveBeenCalled();
    });

    it('should handle data for non-existent TCP connection', () => {
      const testData = Buffer.from('Test data');
      const nonExistentUuid = 'non-existent-uuid';

      expect(() => {
        handleParsedMessage(
          mockWebSocket,
          testConfig.tunnelId,
          nonExistentUuid,
          0x02, // MESSAGE_TYPE_DATA
          testData,
          testConfig.tunnelIdHeaderName,
          testConfig.port
        );
      }).not.toThrow();

      expect(mockTcpSocket.write).not.toHaveBeenCalled();
    });

    it('should handle empty data payload', () => {
      const emptyData = Buffer.alloc(0);

      handleParsedMessage(
        mockWebSocket,
        testConfig.tunnelId,
        testConfig.uuid,
        0x02, // MESSAGE_TYPE_DATA
        emptyData,
        testConfig.tunnelIdHeaderName,
        testConfig.port
      );

      expect(mockTcpSocket.write).toHaveBeenCalledWith(emptyData);
    });

    it('should handle large data payloads', () => {
      const largeData = Buffer.alloc(65536, 'x'); // 64KB of data

      handleParsedMessage(
        mockWebSocket,
        testConfig.tunnelId,
        testConfig.uuid,
        0x02, // MESSAGE_TYPE_DATA
        largeData,
        testConfig.tunnelIdHeaderName,
        testConfig.port
      );

      expect(mockTcpSocket.write).toHaveBeenCalledWith(largeData);
    });
  });

  describe('State management', () => {
    it('should initialize port state if not exists', () => {
      const configPayload = Buffer.from(
        JSON.stringify({
          TUNNEL_ENTRY_PORT: 4443,
        })
      );

      handleParsedMessage(
        mockWebSocket,
        testConfig.tunnelId,
        testConfig.uuid,
        0x01, // MESSAGE_TYPE_CONFIG
        configPayload,
        testConfig.tunnelIdHeaderName,
        testConfig.port
      );

      expect(mockState[testConfig.port]).toBeDefined();
      expect(mockState[testConfig.port].websocketTunnels).toBeDefined();
    });

    it('should initialize websocketTunnels if not exists', () => {
      // Pre-populate state without websocketTunnels
      mockState[testConfig.port] = {};

      const configPayload = Buffer.from(
        JSON.stringify({
          TUNNEL_ENTRY_PORT: 4443,
        })
      );

      handleParsedMessage(
        mockWebSocket,
        testConfig.tunnelId,
        testConfig.uuid,
        0x01, // MESSAGE_TYPE_CONFIG
        configPayload,
        testConfig.tunnelIdHeaderName,
        testConfig.port
      );

      expect(mockState[testConfig.port].websocketTunnels).toBeDefined();
    });

    it('should handle missing state gracefully for data messages', () => {
      // Clear all state
      Object.keys(mockState).forEach((key) => delete mockState[key]);

      const testData = Buffer.from('Test data');

      expect(() => {
        handleParsedMessage(
          mockWebSocket,
          testConfig.tunnelId,
          testConfig.uuid,
          0x02, // MESSAGE_TYPE_DATA
          testData,
          testConfig.tunnelIdHeaderName,
          testConfig.port
        );
      }).not.toThrow();
    });
  });

  describe('Unknown message types', () => {
    it('should handle unknown message type gracefully', () => {
      const unknownType = 0x99;
      const testData = Buffer.from('Test data');

      expect(() => {
        handleParsedMessage(mockWebSocket, testConfig.tunnelId, testConfig.uuid, unknownType, testData, testConfig.tunnelIdHeaderName, testConfig.port);
      }).not.toThrow();
    });
  });
});

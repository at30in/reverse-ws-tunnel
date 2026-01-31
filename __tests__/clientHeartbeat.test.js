const { connectWebSocket, resetClients } = require('../client/tunnelClient');
const WebSocket = require('ws');
const net = require('net');

jest.mock('ws');
jest.mock('net');
jest.mock('../client/utils', () => ({
  buildMessageBuffer: jest.fn((tunnelId, uuid, type, payload) => {
    const uuidBuffer = Buffer.from(uuid || 'test-uuid', 'utf8').slice(0, 36);
    const typeBuffer = Buffer.from([type]);
    const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(uuidBuffer.length + typeBuffer.length + payloadBuffer.length, 0);
    return Buffer.concat([lengthBuffer, uuidBuffer, typeBuffer, payloadBuffer]);
  }),
}));

jest.mock('../package.json', () => ({ version: '1.0.9' }));
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
  setLogContext: jest.fn(),
}));

describe('Client Heartbeat', () => {
  let mockWs;
  let connectWebSocket;

  beforeEach(() => {
    jest.clearAllMocks();

    mockWs = {
      on: jest.fn(),
      once: jest.fn(),
      send: jest.fn(),
      ping: jest.fn(),
      terminate: jest.fn(),
      readyState: WebSocket.OPEN,
      OPEN: WebSocket.OPEN,
    };

    WebSocket.mockReturnValue(mockWs);
    ({ connectWebSocket } = require('../client/tunnelClient'));
  });

  afterEach(() => {
    jest.clearAllMocks();
    resetClients();
    jest.useRealTimers();
  });

  describe('Application-level ping/pong', () => {
    it('should send first ping with sequence number 0', () => {
      jest.useFakeTimers();
      const config = {
        tunnelId: 'test-tunnel',
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();
      jest.advanceTimersByTime(25000);

      const pingCalls = mockWs.send.mock.calls.filter(
        call => call[0] && call[0].toString().includes('"type":"ping"')
      );
      expect(pingCalls.length).toBeGreaterThanOrEqual(1);

      const match = pingCalls[0][0].toString().match(/"seq":(\d+)/);
      expect(match).toBeTruthy();
      expect(parseInt(match[1])).toBe(0);

      jest.useRealTimers();
    });

    it('should increment sequence number with each ping', () => {
      jest.useFakeTimers();
      const config = {
        tunnelId: 'test-tunnel',
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();
      jest.advanceTimersByTime(65000);

      const pingCalls = mockWs.send.mock.calls.filter(
        call => call[0] && call[0].toString().includes('"type":"ping"')
      );
      expect(pingCalls.length).toBeGreaterThanOrEqual(3);

      const sequences = pingCalls
        .map(call => {
          const match = call[0].toString().match(/"seq":(\d+)/);
          return match ? parseInt(match[1]) : -1;
        })
        .filter(seq => seq !== -1);

      expect(sequences).toEqual([0, 1, 2]);

      jest.useRealTimers();
    });

    it('should update lastPongTs when valid pong is received', () => {
      jest.useFakeTimers();
      const config = {
        tunnelId: 'test-tunnel',
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();
      jest.advanceTimersByTime(25000);

      const messageCallback = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      const payload = Buffer.from('{"type":"pong","seq":0}');
      const pongMessage = Buffer.concat([
        Buffer.alloc(4),
        Buffer.from('test-tunnel'.padEnd(36, ' ')),
        Buffer.from('test-uuid'.padEnd(36, ' ')),
        Buffer.from([0x04]),
        payload,
      ]);
      pongMessage.writeUInt32BE(36 + 36 + 1 + payload.length, 0);
      messageCallback(pongMessage);

      jest.advanceTimersByTime(40000);
      expect(mockWs.terminate).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('Health monitoring', () => {
    it('should not terminate within 45 seconds of connection', () => {
      jest.useFakeTimers();
      const config = {
        tunnelId: 'test-tunnel',
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();

      jest.advanceTimersByTime(44000);
      expect(mockWs.terminate).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should terminate after 45 seconds without pong response', () => {
      jest.useFakeTimers();
      const config = {
        tunnelId: 'test-tunnel',
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();

      jest.advanceTimersByTime(50000);
      expect(mockWs.terminate).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});

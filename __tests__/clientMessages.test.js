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

describe('Client Message Handling', () => {
  let mockWs;
  let mockTcpSocket;
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

    mockTcpSocket = {
      on: jest.fn(),
      once: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    WebSocket.mockReturnValue(mockWs);
    net.createConnection.mockReturnValue(mockTcpSocket);

    ({ connectWebSocket } = require('../client/tunnelClient'));
  });

  afterEach(() => {
    jest.clearAllMocks();
    resetClients();
    jest.useRealTimers();
  });

  describe('Configuration message', () => {
    it('should send config on WebSocket open', () => {
      const config = {
        tunnelId: 'test-tunnel'.padEnd(36, ' '),
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();

      expect(mockWs.send).toHaveBeenCalled();
      const sendCall = mockWs.send.mock.calls[0];
      expect(sendCall[0]).toBeInstanceOf(Buffer);
    });
  });

  describe('Data messages', () => {
    it('should create TCP connection on data message', () => {
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

      const messageCallback = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      const dataPayload = Buffer.from('test data');
      const dataMessage = Buffer.concat([
        Buffer.alloc(4),
        Buffer.from('test-tunnel'.padEnd(36, ' ')),
        Buffer.from('test-uuid'.padEnd(36, ' ')),
        Buffer.from([0x02]),
        dataPayload,
      ]);
      dataMessage.writeUInt32BE(36 + 36 + 1 + dataPayload.length, 0);

      messageCallback(dataMessage);

      expect(net.createConnection).toHaveBeenCalledWith(3000, 'localhost');
      jest.useRealTimers();
    });

    it('should close TCP connection on CLOSE message', () => {
      jest.useFakeTimers();
      const config = {
        tunnelId: 'test-tunnel'.padEnd(36, ' '),
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();

      const messageCallback = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];

      // First create connection
      const dataPayload = Buffer.from('test data');
      const dataMessage = Buffer.concat([
        Buffer.alloc(4),
        Buffer.from('test-tunnel'.padEnd(36, ' ')),
        Buffer.from('test-uuid'.padEnd(36, ' ')),
        Buffer.from([0x02]),
        dataPayload,
      ]);
      dataMessage.writeUInt32BE(36 + 36 + 1 + dataPayload.length, 0);
      messageCallback(dataMessage);

      // Then send CLOSE
      const closePayload = Buffer.from('CLOSE');
      const closeMessage = Buffer.concat([
        Buffer.alloc(4),
        Buffer.from('test-tunnel'.padEnd(36, ' ')),
        Buffer.from('test-uuid'.padEnd(36, ' ')),
        Buffer.from([0x02]),
        closePayload,
      ]);
      closeMessage.writeUInt32BE(36 + 36 + 1 + closePayload.length, 0);
      messageCallback(closeMessage);

      expect(mockTcpSocket.end).toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe('Pong messages', () => {
    it('should accept pong with sequence number in valid window', () => {
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
});

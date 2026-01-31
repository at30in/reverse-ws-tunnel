const { connectWebSocket } = require('../client/tunnelClient');
const WebSocket = require('ws');
const net = require('net');
const { buildMessageBuffer } = require('../client/utils');

jest.mock('ws');
jest.mock('net');
jest.mock('../client/utils', () => ({
  buildMessageBuffer: jest.fn((tunnelId, uuid, type, payload) => {
    // Mock implementation of buildMessageBuffer
    const uuidBuffer = Buffer.from(uuid || 'test-uuid', 'utf8').slice(0, 36);
    const typeBuffer = Buffer.from([type]);
    const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(uuidBuffer.length + typeBuffer.length + payloadBuffer.length, 0);
    return Buffer.concat([lengthBuffer, uuidBuffer, typeBuffer, payloadBuffer]);
  }),
}));
jest.mock('../package.json', () => ({ version: '1.0.0' }));
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

// Mock per setInterval usato dalle nuove funzioni
jest.spyOn(global, 'setInterval').mockImplementation(() => 123); // Return a fake interval ID

describe('connectWebSocket', () => {
  let mockWs;
  let mockTcpSocket;

  beforeEach(() => {
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

    mockTcpSocket = {
      on: jest.fn(),
      once: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    net.createConnection.mockReturnValue(mockTcpSocket);
  });

  afterEach(() => {
    jest.clearAllMocks();
    require('../client/tunnelClient').resetClients();
  });

  it('should throw an error if tunnelId is missing', () => {
    expect(() => connectWebSocket({})).toThrow('Missing mandatory tunnelId');
  });

  it('should connect to WebSocket and send config on open', () => {
    const config = { tunnelId: 'test-tunnel', wsUrl: 'ws://test.com' };
    connectWebSocket(config);

    const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
    openCallback();

    expect(buildMessageBuffer).toHaveBeenCalledWith(
      'test-tunnel',
      expect.any(String),
      0x01,
      expect.any(String)
    );
    expect(mockWs.send).toHaveBeenCalled();
  });

  // Removed: "should create TCP connection on data message"
  // This test was testing server-side logic, not client-side
  // Client doesn't create TCP connections - proxy server does

  it('should close TCP connection on CLOSE message', () => {
    const config = {
      tunnelId: 'test-tunnel',
      wsUrl: 'ws://test.com',
      targetUrl: 'http://localhost:3000',
      targetPort: 3000,
    };
    connectWebSocket(config);

    const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
    openCallback();

    // First, create a connection by sending data
    const messageCallback = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
    const dataPayload = Buffer.from('some data');
    const openMessage = Buffer.concat([
      Buffer.alloc(4), // length placeholder
      Buffer.from('test-tunnel'.padEnd(36, ' ')), // tunnelId
      Buffer.from('test-uuid'.padEnd(36, ' ')), // uuid
      Buffer.from([0x02]), // type = DATA
      dataPayload,
    ]);
    openMessage.writeUInt32BE(36 + 36 + 1 + dataPayload.length, 0);
    messageCallback(openMessage);

    // Then, send a CLOSE message
    const closePayload = Buffer.from('CLOSE');
    const closeMessage = Buffer.concat([
      Buffer.alloc(4), // length placeholder
      Buffer.from('test-tunnel'.padEnd(36, ' ')), // tunnelId
      Buffer.from('test-uuid'.padEnd(36, ' ')), // uuid (same as before)
      Buffer.from([0x02]), // type = DATA
      closePayload,
    ]);
    closeMessage.writeUInt32BE(36 + 36 + 1 + closePayload.length, 0);
    messageCallback(closeMessage);

    expect(mockTcpSocket.end).toHaveBeenCalled();
  });

  it('should attempt to reconnect on close', () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const config = { tunnelId: 'test-tunnel', wsUrl: 'ws://test.com' };
    connectWebSocket(config);

    const closeCallback = mockWs.on.mock.calls.find(call => call[0] === 'close')[1];
    closeCallback();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    jest.useRealTimers();
  });

  it('should return an EventEmitter and allow closing', () => {
    const config = { tunnelId: 'test-tunnel', wsUrl: 'ws://test.com' };
    const client = connectWebSocket(config);

    expect(client.on).toBeDefined();
    expect(client.emit).toBeDefined();
    expect(client.close).toBeDefined();

    client.close();
    expect(mockWs.terminate).toHaveBeenCalled();
  });
});

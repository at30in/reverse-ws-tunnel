const { connectWebSocket } = require('../client/tunnelClient');
const WebSocket = require('ws');
const net = require('net');
const { buildMessageBuffer } = require('../client/utils');

jest.mock('ws');
jest.mock('net');
jest.mock('../client/utils');
jest.mock('../package.json', () => ({ version: '1.0.0' }));
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
}));

describe('connectWebSocket', () => {
  let mockWs;
  let mockTcpSocket;

  beforeEach(() => {
    jest.resetModules();
    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      ping: jest.fn(),
      terminate: jest.fn(),
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

    expect(buildMessageBuffer).toHaveBeenCalledWith('test-tunnel', expect.any(String), 0x01, expect.any(String));
    expect(mockWs.send).toHaveBeenCalled();
  });

  it('should create TCP connection on data message', () => {
    const config = { tunnelId: 'test-tunnel', wsUrl: 'ws://test.com', targetUrl: 'http://localhost:3000', targetPort: 3000 };
    connectWebSocket(config);

    const messageCallback = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
    const message = Buffer.concat([
      Buffer.from('test-uuid'.padEnd(36, ' ')),
      Buffer.from([0x02]),
      Buffer.from('some data'),
    ]);
    messageCallback(message);

    expect(net.createConnection).toHaveBeenCalledWith(3000, 'localhost');
    expect(mockTcpSocket.write).toHaveBeenCalledWith(Buffer.from('some data'));
  });

  it('should close TCP connection on CLOSE message', () => {
    const config = { tunnelId: 'test-tunnel', wsUrl: 'ws://test.com', targetUrl: 'http://localhost:3000', targetPort: 3000 };
    connectWebSocket(config);

    // First, create a connection
    const messageCallback = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
    const openMessage = Buffer.concat([
      Buffer.from('test-uuid'.padEnd(36, ' ')),
      Buffer.from([0x02]),
      Buffer.from('some data'),
    ]);
    messageCallback(openMessage);

    // Then, send a CLOSE message
    const closeMessage = Buffer.concat([
      Buffer.from('test-uuid'.padEnd(36, ' ')),
      Buffer.from([0x02]),
      Buffer.from('CLOSE'),
    ]);
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

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    jest.useRealTimers();
  });
});

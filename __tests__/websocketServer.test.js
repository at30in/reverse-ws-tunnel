const { startWebSocketServer } = require('../server/websocketServer');
const WebSocket = require('ws');
const state = require('../server/state');
const { handleParsedMessage } = require('../server/messageHandler');

jest.mock('ws');
jest.mock('../server/messageHandler');
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
}));

describe('startWebSocketServer', () => {
  let mockServer;
  let mockWs;

  beforeEach(() => {
    jest.useFakeTimers();
    mockWs = {
      on: jest.fn(),
      ping: jest.fn(),
      terminate: jest.fn(),
      removeAllListeners: jest.fn(),
      readyState: WebSocket.OPEN,
    };
    mockServer = {
      on: jest.fn((event, cb) => {
        if (event === 'listening') {
          cb();
        }
      }),
    };
    WebSocket.Server.mockReturnValue(mockServer);
    state['8080'] = {};
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('should create a WebSocket server and listen on the specified port', () => {
    startWebSocketServer({ port: 8080, tunnelIdHeaderName: 'x-tunnel-id' });
    expect(WebSocket.Server).toHaveBeenCalledWith({ port: 8080, host: undefined, path: undefined });
    expect(mockServer.on).toHaveBeenCalledWith('listening', expect.any(Function));
  });

  it('should handle a new WebSocket connection', () => {
    startWebSocketServer({ port: 8080, tunnelIdHeaderName: 'x-tunnel-id' });
    const connectionCallback = mockServer.on.mock.calls.find(call => call[0] === 'connection')[1];
    connectionCallback(mockWs, { socket: { remoteAddress: '127.0.0.1' } });
    expect(mockWs.on).toHaveBeenCalledWith('pong', expect.any(Function));
    expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should handle incoming messages', () => {
    startWebSocketServer({ port: 8080, tunnelIdHeaderName: 'x-tunnel-id' });
    const connectionCallback = mockServer.on.mock.calls.find(call => call[0] === 'connection')[1];
    connectionCallback(mockWs, { socket: { remoteAddress: '127.0.0.1' } });

    const messageCallback = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
    const message = Buffer.concat([
      Buffer.from('test-tunnel-id'.padEnd(36, ' ')),
      Buffer.from('test-uuid'.padEnd(36, ' ')),
      Buffer.from([0x01]),
      Buffer.from('payload'),
    ]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(message.length, 0);

    messageCallback(Buffer.concat([length, message]));

    expect(handleParsedMessage).toHaveBeenCalledWith(
      mockWs,
      'test-tunnel-id'.padEnd(36, ' '),
      'test-uuid'.padEnd(36, ' '),
      0x01,
      expect.any(Buffer),
      'x-tunnel-id',
      '8080'
    );
  });

  it('should terminate connection on missed heartbeat', () => {
    jest.useFakeTimers();
    startWebSocketServer({ port: 8080, tunnelIdHeaderName: 'x-tunnel-id' });
    const connectionCallback = mockServer.on.mock.calls.find(call => call[0] === 'connection')[1];
    connectionCallback(mockWs, { socket: { remoteAddress: '127.0.0.1' } });

    mockWs.isAlive = false;
    jest.advanceTimersByTime(30000);

    expect(mockWs.terminate).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('should cleanup on close', () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    startWebSocketServer({ port: 8080, tunnelIdHeaderName: 'x-tunnel-id' });
    const connectionCallback = mockServer.on.mock.calls.find(call => call[0] === 'connection')[1];
    connectionCallback(mockWs, { socket: { remoteAddress: '127.0.0.1' } });

    const closeCallback = mockWs.on.mock.calls.find(call => call[0] === 'close')[1];
    closeCallback();

    expect(mockWs.terminate).toHaveBeenCalled();
    expect(mockWs.removeAllListeners).toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});

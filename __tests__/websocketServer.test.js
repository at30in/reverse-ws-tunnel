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

// Imports after mocks
const { startWebSocketServer, stopWebSocketServer } = require('../server/websocketServer');
const WebSocket = require('ws');
const state = require('../server/state');
const { handleParsedMessage } = require('../server/messageHandler');

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
    // Clean up state
    delete state['8080'];
    delete state['9090'];
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

describe('stopWebSocketServer', () => {
  let mockServer;
  let mockWs;
  let mockTcpServer;

  beforeEach(() => {
    jest.useFakeTimers();
    mockWs = {
      on: jest.fn(),
      ping: jest.fn(),
      terminate: jest.fn(),
      removeAllListeners: jest.fn(),
      close: jest.fn(),
      readyState: WebSocket.OPEN,
    };
    mockServer = {
      on: jest.fn((event, cb) => {
        if (event === 'listening') {
          cb();
        }
      }),
      close: jest.fn(cb => {
        if (cb) cb();
      }),
    };
    mockTcpServer = {
      close: jest.fn(cb => {
        if (cb) cb();
      }),
    };
    WebSocket.Server.mockReturnValue(mockServer);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    // Clean up state
    delete state['8080'];
    delete state['9090'];
  });

  it('should do nothing if no server exists on the port', async () => {
    await stopWebSocketServer(8080);
    // Should not throw and should not modify state
    expect(state['8080']).toBeUndefined();
  });

  it('should close all WebSocket connections', async () => {
    startWebSocketServer({ port: 8080, tunnelIdHeaderName: 'x-tunnel-id' });

    // Simulate a connection
    const connectionCallback = mockServer.on.mock.calls.find(call => call[0] === 'connection')[1];
    connectionCallback(mockWs, { socket: { remoteAddress: '127.0.0.1' } });

    // Manually add the WebSocket to websocketTunnels (simulating what happens when a message is processed)
    state['8080'].websocketTunnels['test-tunnel-id'] = { ws: mockWs };

    // Verify tunnel is in state
    expect(state['8080'].websocketTunnels).toBeDefined();

    // Stop the server
    await stopWebSocketServer(8080);

    // Verify WebSocket close was called
    expect(mockWs.close).toHaveBeenCalledWith(1000, 'Server shutting down');
  });

  it('should close all TCP servers in state', async () => {
    startWebSocketServer({ port: 8080, tunnelIdHeaderName: 'x-tunnel-id' });

    // Add a TCP server to state (simulating what tcpServer.js does)
    state['8080']['4443'] = { tcpServer: mockTcpServer };

    await stopWebSocketServer(8080);

    // Verify TCP server was closed
    expect(mockTcpServer.close).toHaveBeenCalled();
  });

  it('should close the main WebSocket server', async () => {
    startWebSocketServer({ port: 8080, tunnelIdHeaderName: 'x-tunnel-id' });

    await stopWebSocketServer(8080);

    // Verify main server was closed
    expect(mockServer.close).toHaveBeenCalled();
  });

  it('should clean up state after stopping', async () => {
    startWebSocketServer({ port: 8080, tunnelIdHeaderName: 'x-tunnel-id' });

    // Verify state exists
    expect(state['8080']).toBeDefined();

    await stopWebSocketServer(8080);

    // Verify state is cleaned up
    expect(state['8080']).toBeUndefined();
  });

  it('should handle calling stop on already stopped server gracefully', async () => {
    startWebSocketServer({ port: 8080, tunnelIdHeaderName: 'x-tunnel-id' });
    await stopWebSocketServer(8080);

    // Call stop again - should not throw
    await expect(stopWebSocketServer(8080)).resolves.not.toThrow();
  });
});

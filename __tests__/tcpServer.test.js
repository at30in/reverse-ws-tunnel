const { startTCPServer, ensureTCPServer } = require('../server/tcpServer');
const net = require('net');
const state = require('../server/state');
const { MESSAGE_TYPE_DATA } = require('../server/constants');

jest.mock('net');
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
}));

describe('startTCPServer', () => {
  let mockSocket;
  let mockServer;
  let mockWs;

  beforeEach(() => {
    mockSocket = {
      on: jest.fn(),
      once: jest.fn(),
      destroy: jest.fn(),
      write: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      isPaused: () => false,
      destroyed: false,
      address: () => ({ port: 3000 }),
    };
    mockServer = {
      // Accept both forms: listen(port, cb) or listen({port, host, reuseAddr}, cb)
      listen: jest.fn((portOrOpts, cb) => {
        if (typeof cb === 'function') cb();
      }),
      on: jest.fn(),
      address: () => ({ port: 3000 }),
    };
    net.createServer.mockReturnValue(mockServer);

    mockWs = {
      send: jest.fn(),
      readyState: 1, // WebSocket.OPEN
    };

    state['8080'] = {
      3000: {},
      websocketTunnels: {
        'test-tunnel': {
          ws: mockWs,
          tcpConnections: {},
        },
      },
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create a TCP server and listen on the specified port', async () => {
    await startTCPServer(3000, 'x-tunnel-id', 8080);
    expect(net.createServer).toHaveBeenCalled();
    // Now accepts both number and object form
    expect(mockServer.listen).toHaveBeenCalled();
    const callArg = mockServer.listen.mock.calls[0][0];
    expect(callArg.port).toBe(3000);
  });

  it('should handle a new TCP connection', () => {
    startTCPServer(3000, 'x-tunnel-id', 8080);
    // Connection callback is the SECOND argument to net.createServer(options, callback)
    const connectionCallback = net.createServer.mock.calls[0][1];
    connectionCallback(mockSocket);
    expect(mockSocket.on).toHaveBeenCalledWith('data', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('end', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should destroy socket for invalid tunnel ID', done => {
    startTCPServer(3000, 'x-tunnel-id', 8080);
    const connectionCallback = net.createServer.mock.calls[0][1];
    connectionCallback(mockSocket);

    const dataCallback = mockSocket.on.mock.calls.find(call => call[0] === 'data')[1];

    const headers = 'GET / HTTP/1.1\r\nX-Tunnel-Id: invalid-tunnel\r\n\r\n';
    dataCallback(Buffer.from(headers));

    // Allow time for async operations
    setTimeout(() => {
      expect(mockSocket.destroy).toHaveBeenCalled();
      done();
    }, 100);
  });

  it('should forward data to the correct tunnel', done => {
    startTCPServer(3000, 'x-tunnel-id', 8080);
    const connectionCallback = net.createServer.mock.calls[0][1];
    connectionCallback(mockSocket);

    const dataCallback = mockSocket.on.mock.calls.find(call => call[0] === 'data')[1];

    const headers = 'GET / HTTP/1.1\r\nX-Tunnel-Id: test-tunnel\r\n\r\n';
    dataCallback(Buffer.from(headers));

    setTimeout(() => {
      expect(mockWs.send).toHaveBeenCalled();
      const sentData = mockWs.send.mock.calls[0][0];
      expect(sentData.toString()).toContain('GET / HTTP/1.1');
      done();
    }, 100);
  });

  it('should extract tunnel ID from cookie', done => {
    startTCPServer(3000, 'x-tunnel-id', 8080);
    const connectionCallback = net.createServer.mock.calls[0][1];
    connectionCallback(mockSocket);

    const dataCallback = mockSocket.on.mock.calls.find(call => call[0] === 'data')[1];

    const headers = 'GET / HTTP/1.1\r\nCookie: x-tunnel-id=test-tunnel\r\n\r\n';
    dataCallback(Buffer.from(headers));

    setTimeout(() => {
      expect(mockWs.send).toHaveBeenCalled();
      done();
    }, 100);
  });

  it('should handle WebSocket upgrade requests', done => {
    startTCPServer(3000, 'x-tunnel-id', 8080);
    const connectionCallback = net.createServer.mock.calls[0][1];
    connectionCallback(mockSocket);

    const dataCallback = mockSocket.on.mock.calls.find(call => call[0] === 'data')[1];

    const headers = 'GET / HTTP/1.1\r\nUpgrade: websocket\r\nX-Tunnel-Id: test-tunnel\r\n\r\n';
    dataCallback(Buffer.from(headers));

    setTimeout(() => {
      expect(mockWs.send).toHaveBeenCalled();
      // The parser should be closed, so subsequent data is sent raw
      dataCallback(Buffer.from('websocket data'));
      expect(mockWs.send).toHaveBeenCalledTimes(2);
      done();
    }, 100);
  });

  it('should send CLOSE message on socket end', done => {
    startTCPServer(3000, 'x-tunnel-id', 8080);
    const connectionCallback = net.createServer.mock.calls[0][1];
    connectionCallback(mockSocket);

    const dataCallback = mockSocket.on.mock.calls.find(call => call[0] === 'data')[1];
    const endCallback = mockSocket.on.mock.calls.find(call => call[0] === 'end')[1];

    const headers = 'GET / HTTP/1.1\r\nX-Tunnel-Id: test-tunnel\r\n\r\n';
    dataCallback(Buffer.from(headers));

    setTimeout(() => {
      endCallback();
      expect(mockWs.send).toHaveBeenCalledTimes(2);
      const sentData = mockWs.send.mock.calls[1][0]; // The second call is for CLOSE
      expect(sentData.toString()).toContain('CLOSE');
      done();
    }, 100);
  });
});

describe('ensureTCPServer', () => {
  let mockServer;
  let mockTakeoverServer;

  beforeEach(() => {
    mockServer = {
      // Accept both forms: listen(port, cb) or listen({port, host, reuseAddr}, cb)
      listen: jest.fn((portOrOpts, cb) => {
        if (typeof cb === 'function') cb();
      }),
      on: jest.fn(),
      address: () => ({ port: 3000 }),
    };
    mockTakeoverServer = {
      listen: jest.fn((portOrOpts, cb) => {
        if (typeof cb === 'function') cb();
      }),
      on: jest.fn((event, cb) => {
        if (event === 'error') {
          // Simulate port not in use - error handler is set but won't be called
        }
        if (event === 'listening') {
          // Simulate port is available - listening event fires immediately
          setTimeout(() => cb(), 0);
        }
        return mockTakeoverServer;
      }),
      close: jest.fn(cb => {
        if (cb) setTimeout(cb, 0);
      }),
      address: () => ({ port: 3000 }),
    };

    state['8080'] = {
      3000: {},
      websocketTunnels: {},
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call startTCPServer directly (no takeover server)', async () => {
    // ensureTCPServer calls startTCPServer directly, not a separate takeover server
    // It retries on EADDRINUSE but doesn't use a separate takeover check
    net.createServer.mockReturnValue(mockServer);

    await ensureTCPServer(3000, 'x-tunnel-id', 8080);

    // Should have called createServer once (startTCPServer calls createServer once)
    expect(net.createServer).toHaveBeenCalledTimes(1);
    // The server should have called listen with object form
    expect(mockServer.listen).toHaveBeenCalled();
    const listenCall = mockServer.listen.mock.calls[0];
    expect(listenCall[0].port).toBe(3000);
    expect(typeof listenCall[1]).toBe('function');
  });

  it('should return the TCP server (caller stores in state)', async () => {
    // ensureTCPServer returns the server, caller (messageHandler.js) stores it in state
    net.createServer.mockReturnValue(mockServer);

    const result = await ensureTCPServer(3000, 'x-tunnel-id', 8080);

    // The function should return the server instance
    expect(result).toBe(mockServer);
  });
});

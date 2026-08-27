const { startHttpProxyServer } = require('../client/proxyServer');
const http = require('http');
const httpProxy = require('http-proxy');

jest.mock('http');
jest.mock('http-proxy');
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
}));

describe('startHttpProxyServer', () => {
  let mockServer;
  let mockProxy;
  let mockReq;
  let mockRes;
  let mockSocket;
  let mockHead;

  beforeEach(() => {
    mockServer = {
      listen: jest.fn((port, cb) => {
        mockServer.address = () => ({ port: 12345 });
        mockServer.listening = true;
        cb();
      }),
      on: jest.fn(),
      address: () => ({ port: 0 }),
      close: jest.fn(),
      listening: false,
    };
    http.createServer.mockReturnValue(mockServer);

    mockProxy = {
      web: jest.fn(),
      ws: jest.fn(),
      on: jest.fn(),
    };
    httpProxy.createProxyServer.mockReturnValue(mockProxy);

    mockReq = {};
    mockRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
    };
    mockSocket = {};
    mockHead = {};
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create an HTTP proxy server and listen on a random port', () => {
    const result = startHttpProxyServer('http://target.com');
    expect(http.createServer).toHaveBeenCalled();
    expect(mockServer.listen).toHaveBeenCalledWith(0, expect.any(Function));
    expect(result).toHaveProperty('port');
    expect(result).toHaveProperty('close');
    result.close();
    expect(mockServer.close).toHaveBeenCalled();
  });

  it('should proxy HTTP requests', () => {
    startHttpProxyServer('http://target.com');
    const requestCallback = http.createServer.mock.calls[0][0];
    requestCallback(mockReq, mockRes);
    expect(mockProxy.web).toHaveBeenCalledWith(
      mockReq,
      mockRes,
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('should proxy WebSocket upgrade requests', () => {
    startHttpProxyServer('http://target.com');
    const upgradeCallback = mockServer.on.mock.calls.find(call => call[0] === 'upgrade')[1];
    upgradeCallback(mockReq, mockSocket, mockHead);
    expect(mockProxy.ws).toHaveBeenCalledWith(
      mockReq,
      mockSocket,
      mockHead,
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('should handle requests without targetUrl gracefully', () => {
    startHttpProxyServer(null);
    const requestCallback = http.createServer.mock.calls[0][0];
    requestCallback(mockReq, mockRes);
    expect(mockRes.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'text/plain' });
    expect(mockRes.end).toHaveBeenCalledWith('Missing TARGET_URL');
  });

  it('should return 502 on proxy error', () => {
    mockProxy.web.mockImplementation((req, res, options, cb) => {
      cb(new Error('Proxy error'));
    });
    startHttpProxyServer('http://target.com');
    const requestCallback = http.createServer.mock.calls[0][0];
    requestCallback(mockReq, mockRes);
    expect(mockRes.writeHead).toHaveBeenCalledWith(502);
    expect(mockRes.end).toHaveBeenCalledWith('Bad gateway');
  });
});

describe('RWT-KNOWN-008 proxyServer double-close', () => {
  it('double close() does not throw even when server.close() throws on second call', () => {
    let closeCount = 0;
    const strictServer = {
      listen: jest.fn((port, cb) => {
        strictServer.listening = true;
        cb();
      }),
      on: jest.fn(),
      address: () => ({ port: 9999 }),
      close: jest.fn(() => {
        closeCount++;
        strictServer.listening = false;
        if (closeCount > 1) {
          const err = new Error('Server is not running.');
          err.code = 'ERR_SERVER_NOT_RUNNING';
          throw err;
        }
      }),
      listening: false,
    };
    http.createServer.mockReturnValue(strictServer);

    const proxy = startHttpProxyServer('http://target.com');
    proxy.close();
    // Second close must not throw ERR_SERVER_NOT_RUNNING
    expect(() => proxy.close()).not.toThrow();
  });

  it('close() on already-closed server is idempotent', () => {
    let closeCount = 0;
    const testServer = {
      listen: jest.fn((port, cb) => {
        testServer.listening = true;
        cb();
      }),
      on: jest.fn(),
      address: () => ({ port: 8888 }),
      close: jest.fn(() => {
        closeCount++;
        testServer.listening = false;
        if (closeCount > 1) {
          const err = new Error('Server is not running.');
          err.code = 'ERR_SERVER_NOT_RUNNING';
          throw err;
        }
      }),
      listening: false,
    };
    http.createServer.mockReturnValue(testServer);

    const proxy = startHttpProxyServer('http://target.com');
    proxy.close();
    expect(() => proxy.close()).not.toThrow();
  });

  it('close() is a no-op when server was never listening', () => {
    const neverListenServer = {
      listen: jest.fn(),
      on: jest.fn(),
      address: () => ({ port: 0 }),
      close: jest.fn(),
      listening: false,
    };
    http.createServer.mockReturnValue(neverListenServer);

    const proxy = startHttpProxyServer('http://target.com');
    expect(() => proxy.close()).not.toThrow();
    expect(neverListenServer.close).not.toHaveBeenCalled();
  });
});

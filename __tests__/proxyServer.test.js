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
        cb();
      }),
      on: jest.fn(),
      address: () => ({ port: 0 }),
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
    startHttpProxyServer('http://target.com');
    expect(http.createServer).toHaveBeenCalled();
    expect(mockServer.listen).toHaveBeenCalledWith(0, expect.any(Function));
  });

  it('should proxy HTTP requests', () => {
    startHttpProxyServer('http://target.com');
    const requestCallback = http.createServer.mock.calls[0][0];
    requestCallback(mockReq, mockRes);
    expect(mockProxy.web).toHaveBeenCalledWith(mockReq, mockRes, expect.any(Object), expect.any(Function));
  });

  it('should proxy WebSocket upgrade requests', () => {
    startHttpProxyServer('http://target.com');
    const upgradeCallback = mockServer.on.mock.calls.find(call => call[0] === 'upgrade')[1];
    upgradeCallback(mockReq, mockSocket, mockHead);
    expect(mockProxy.ws).toHaveBeenCalledWith(mockReq, mockSocket, mockHead, expect.any(Object), expect.any(Function));
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

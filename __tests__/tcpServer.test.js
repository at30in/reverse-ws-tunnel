const { startTCPServer } = require('../server/tcpServer');
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
      destroy: jest.fn(),
      write: jest.fn(),
    };
    mockServer = {
      listen: jest.fn((port, cb) => cb()),
      on: jest.fn(),
    };
    net.createServer.mockReturnValue(mockServer);

    mockWs = {
      send: jest.fn(),
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

  it('should create a TCP server and listen on the specified port', () => {
    startTCPServer(3000, 'x-tunnel-id', 8080);
    expect(net.createServer).toHaveBeenCalled();
    expect(mockServer.listen).toHaveBeenCalledWith(3000, expect.any(Function));
  });

  it('should handle a new TCP connection', () => {
    startTCPServer(3000, 'x-tunnel-id', 8080);
    const connectionCallback = net.createServer.mock.calls[0][0];
    connectionCallback(mockSocket);
    expect(mockSocket.on).toHaveBeenCalledWith('data', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('end', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should destroy socket for invalid tunnel ID', done => {
    startTCPServer(3000, 'x-tunnel-id', 8080);
    const connectionCallback = net.createServer.mock.calls[0][0];
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
    const connectionCallback = net.createServer.mock.calls[0][0];
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
    const connectionCallback = net.createServer.mock.calls[0][0];
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
    const connectionCallback = net.createServer.mock.calls[0][0];
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
    const connectionCallback = net.createServer.mock.calls[0][0];
    connectionCallback(mockSocket);

    const dataCallback = mockSocket.on.mock.calls.find(call => call[0] === 'data')[1];
    const endCallback = mockSocket.on.mock.calls.find(call => call[0] === 'end')[1];

    const headers = 'GET / HTTP/1.1\r\nX-Tunnel-Id: test-tunnel\r\n\r\n';
    dataCallback(Buffer.from(headers));

    setTimeout(() => {
      endCallback();
      expect(mockWs.send).toHaveBeenCalledWith(expect.any(Buffer));
      const sentData = mockWs.send.mock.calls[1][0]; // The first call is for the headers
      expect(sentData.toString()).toContain('CLOSE');
      done();
    }, 100);
  });
});

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

jest.mock('../utils/tunnelMetrics', () => ({
  getMetrics: () => ({
    registerStream: jest.fn(),
    unregisterStream: jest.fn(),
    registerTunnel: jest.fn(),
    unregisterTunnel: jest.fn(),
    gauge: jest.fn(),
    increment: jest.fn(),
  }),
}));

jest.mock('../utils/backpressureSender', () => ({
  createBackpressureSender: jest.fn(opts => ({
    send: jest.fn(payload => {
      if (opts.ws && opts.ws.readyState === 1) {
        opts.ws.send(payload);
        return 0;
      }
      return null;
    }),
    destroy: jest.fn(),
  })),
}));

jest.mock('../utils/streamWriteQueue', () => ({
  createStreamWriteQueue: jest.fn(() => ({
    enqueue: jest.fn(),
    destroy: jest.fn(),
    isDestroyed: jest.fn(() => false),
  })),
}));

jest.mock('../utils/tunnelLimits', () => ({
  getTunnelLimits: () => ({
    highWatermark: 8 * 1024 * 1024,
    lowWatermark: 2 * 1024 * 1024,
    maxFrame: 1024 * 1024,
    maxBufferPerStream: 64 * 1024 * 1024,
    maxBufferPerTunnel: 256 * 1024 * 1024,
  }),
}));

const net = require('net');
const { startTCPServer } = require('../server/tcpServer');
const state = require('../server/state');

describe('bodyCoalescer zombie timer (KNOWN-001)', () => {
  let mockSocket;
  let mockWs;
  let wsPort;
  let tcpPort;

  beforeEach(() => {
    jest.useFakeTimers();

    mockSocket = {
      on: jest.fn((event, cb) => {
        if (event === 'close') mockSocket._closeCb = cb;
        if (event === 'error') mockSocket._errorCb = cb;
        if (event === 'data') mockSocket._dataCb = cb;
        if (event === 'end') mockSocket._endCb = cb;
        return mockSocket;
      }),
      once: jest.fn(),
      destroy: jest.fn(),
      write: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      isPaused: jest.fn(() => false),
      destroyed: false,
      address: () => ({ port: 3001 }),
    };

    const mockServer = {
      listen: jest.fn((opts, cb) => {
        if (typeof cb === 'function') cb();
      }),
      on: jest.fn(),
      address: () => ({ port: 3001 }),
    };
    net.createServer.mockReturnValue(mockServer);

    mockWs = {
      send: jest.fn(),
      readyState: 1, // WebSocket.OPEN
    };

    wsPort = 8080;
    tcpPort = 3000;

    state[wsPort] = {
      [tcpPort]: {},
      websocketTunnels: {
        'test-tunnel-001': {
          ws: mockWs,
          tcpConnections: {},
        },
      },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    delete state[wsPort];
  });

  function setupTcpConnection() {
    startTCPServer(tcpPort, 'x-tunnel-id', wsPort);
    const connectionCallback = net.createServer.mock.calls[0][1];
    connectionCallback(mockSocket);
  }

  function sendHeaders() {
    const headers =
      'POST / HTTP/1.1\r\nX-Tunnel-Id: test-tunnel-001\r\nContent-Length: 100000\r\n\r\n';
    mockSocket._dataCb(Buffer.from(headers, 'latin1'));
  }

  function sendBodyChunk(body) {
    mockSocket._dataCb(Buffer.from(body, 'latin1'));
  }

  it('should arrive and arm the 5ms coalescer timer', () => {
    setupTcpConnection();
    sendHeaders();
    const afterHeaders = mockWs.send.mock.calls.length;

    sendBodyChunk('ABC');
    expect(mockWs.send).toHaveBeenCalledTimes(afterHeaders);

    jest.advanceTimersByTime(4);
    expect(mockWs.send).toHaveBeenCalledTimes(afterHeaders);

    jest.advanceTimersByTime(1);
    expect(mockWs.send).toHaveBeenCalledTimes(afterHeaders + 1);
  });

  it('should cancel timer on cleanup and not send body data', () => {
    setupTcpConnection();
    sendHeaders();
    const afterHeaders = mockWs.send.mock.calls.length;

    sendBodyChunk('ABC');
    expect(mockWs.send).toHaveBeenCalledTimes(afterHeaders);

    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    expect(mockWs.send).toHaveBeenCalledTimes(afterHeaders);
  });

  it('should not recreate TCP connection for same UUID after cleanup', () => {
    setupTcpConnection();
    sendHeaders();
    sendBodyChunk('ABC');

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuids = Object.keys(tunnel.tcpConnections);
    expect(uuids.length).toBe(1);

    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    expect(tunnel.tcpConnections[uuids[0]]).toBeUndefined();
  });

  it('should still coalesce when cleanup does not occur', () => {
    setupTcpConnection();
    sendHeaders();
    const afterHeaders = mockWs.send.mock.calls.length;

    sendBodyChunk('AAA');
    sendBodyChunk('BBB');

    jest.advanceTimersByTime(4);
    expect(mockWs.send).toHaveBeenCalledTimes(afterHeaders);

    jest.advanceTimersByTime(1);
    expect(mockWs.send).toHaveBeenCalledTimes(afterHeaders + 1);
  });

  it('should flush immediately when body exceeds coalesce threshold', () => {
    setupTcpConnection();
    sendHeaders();
    const afterHeaders = mockWs.send.mock.calls.length;

    const bigBody = Buffer.alloc(65 * 1024, 0x42).toString('latin1');
    sendBodyChunk(bigBody);

    expect(mockWs.send).toHaveBeenCalledTimes(afterHeaders + 1);

    jest.advanceTimersByTime(10);
    expect(mockWs.send).toHaveBeenCalledTimes(afterHeaders + 1);
  });

  it('cleanupConn should be idempotent', () => {
    setupTcpConnection();
    sendHeaders();
    sendBodyChunk('ABC');

    mockSocket._closeCb();
    jest.advanceTimersByTime(10);
    const afterFirst = mockWs.send.mock.calls.length;

    mockSocket._closeCb();
    jest.advanceTimersByTime(10);
    expect(mockWs.send).toHaveBeenCalledTimes(afterFirst);
  });
});

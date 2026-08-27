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

describe('RWT-TCP-002 ensureConn reuse', () => {
  let mockSocket;
  let mockWs;
  let wsPort;
  let tcpPort;
  let createBackpressureSender;
  let createStreamWriteQueue;

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

    createBackpressureSender = require('../utils/backpressureSender').createBackpressureSender;
    createStreamWriteQueue = require('../utils/streamWriteQueue').createStreamWriteQueue;
    createBackpressureSender.mockClear();
    createStreamWriteQueue.mockClear();

    mockWs = {
      send: jest.fn(),
      readyState: 1,
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

  it('should reuse the same conn object when sendData calls ensureConn', () => {
    setupTcpConnection();
    sendHeaders();

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuids = Object.keys(tunnel.tcpConnections);
    expect(uuids.length).toBe(1);

    const connBefore = tunnel.tcpConnections[uuids[0]];
    expect(connBefore).toBeDefined();
    expect(connBefore.socket).toBe(mockSocket);

    sendBodyChunk('ABC');
    jest.advanceTimersByTime(10);

    const connAfter = tunnel.tcpConnections[uuids[0]];
    expect(connAfter).toBe(connBefore);
  });

  it('should not create a second sender or queue for the same UUID', () => {
    setupTcpConnection();
    sendHeaders();

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuids = Object.keys(tunnel.tcpConnections);
    expect(uuids.length).toBe(1);

    const senderCallsAfterHeaders = createBackpressureSender.mock.calls.length;
    const queueCallsAfterHeaders = createStreamWriteQueue.mock.calls.length;

    sendBodyChunk('AAA');
    sendBodyChunk('BBB');
    sendBodyChunk('CCC');
    jest.advanceTimersByTime(10);

    expect(createBackpressureSender.mock.calls.length).toBe(senderCallsAfterHeaders);
    expect(createStreamWriteQueue.mock.calls.length).toBe(queueCallsAfterHeaders);
  });

  it('should maintain the same entry in tunnel.tcpConnections after body data', () => {
    setupTcpConnection();
    sendHeaders();

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuids = Object.keys(tunnel.tcpConnections);
    const uuid = uuids[0];

    const ref1 = tunnel.tcpConnections[uuid];
    sendBodyChunk('X');
    jest.advanceTimersByTime(10);
    const ref2 = tunnel.tcpConnections[uuid];

    sendBodyChunk('Y');
    jest.advanceTimersByTime(10);
    const ref3 = tunnel.tcpConnections[uuid];

    expect(ref1).toBe(ref2);
    expect(ref2).toBe(ref3);
    expect(Object.keys(tunnel.tcpConnections).length).toBe(1);
  });

  it('should forward body data through the existing sender', () => {
    setupTcpConnection();
    sendHeaders();

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuids = Object.keys(tunnel.tcpConnections);
    const conn = tunnel.tcpConnections[uuids[0]];
    const sendSpy = conn.sender.send;

    sendBodyChunk('DATA1');
    jest.advanceTimersByTime(10);

    expect(sendSpy).toHaveBeenCalled();
  });
});

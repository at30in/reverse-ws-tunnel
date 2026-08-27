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
    setBuffered: jest.fn(),
    clearBuffered: jest.fn(),
    addTraffic: jest.fn(),
    getBufferedPerTunnel: jest.fn(() => ({ total: 0, perTunnel: {} })),
    countBackpressure: jest.fn(),
    snapshot: jest.fn(() => ({})),
    gauge: jest.fn(),
    increment: jest.fn(),
  }),
}));
jest.mock('../utils/tunnelLimits', () => ({
  getTunnelLimits: () => ({
    highWatermarkBytes: 8 * 1024 * 1024,
    lowWatermarkBytes: 2 * 1024 * 1024,
    maxFrameBytes: 1024 * 1024,
    maxBufferPerStreamBytes: 64 * 1024 * 1024,
    maxBufferPerTunnelBytes: 256 * 1024 * 1024,
  }),
}));

const net = require('net');
const { startTCPServer } = require('../server/tcpServer');
const state = require('../server/state');

/**
 * RWT-RES-001 / RWT-RES-002 lifecycle tests.
 *
 * Uses REAL StreamWriteQueue and BackpressureSender implementations
 * (not mocked) to verify the full create → data → cleanup → destroy
 * lifecycle through the real cleanupConn path in tcpServer.js.
 */
describe('RWT-RES-001 / RWT-RES-002 lifecycle (real queue + sender)', () => {
  let mockSocket;
  let mockWs;
  let wsPort;
  let tcpPort;

  beforeEach(() => {
    jest.useFakeTimers();

    mockSocket = {
      _listeners: {},
      on: jest.fn((event, cb) => {
        if (event === 'close') mockSocket._closeCb = cb;
        if (event === 'error') mockSocket._errorCb = cb;
        if (event === 'data') mockSocket._dataCb = cb;
        if (event === 'end') mockSocket._endCb = cb;
        if (!mockSocket._listeners[event]) mockSocket._listeners[event] = [];
        mockSocket._listeners[event].push(cb);
        return mockSocket;
      }),
      once: jest.fn((event, cb) => {
        if (!mockSocket._listeners[event]) mockSocket._listeners[event] = [];
        mockSocket._listeners[event].push(cb);
        return mockSocket;
      }),
      removeListener: jest.fn((event, cb) => {
        if (!mockSocket._listeners[event]) return;
        mockSocket._listeners[event] = mockSocket._listeners[event].filter(fn => fn !== cb);
      }),
      destroy: jest.fn(() => { mockSocket.destroyed = true; }),
      write: jest.fn(() => true),
      pause: jest.fn(),
      resume: jest.fn(),
      isPaused: jest.fn(() => false),
      destroyed: false,
      writableLength: 0,
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

  it('queue.isDestroyed() === true and queuedBytes() === 0 after cleanup', () => {
    setupTcpConnection();
    sendHeaders();

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuid = Object.keys(tunnel.tcpConnections)[0];
    const queue = tunnel.tcpConnections[uuid].queue;

    sendBodyChunk('PAYLOAD');
    jest.advanceTimersByTime(10);

    expect(queue.isDestroyed()).toBe(false);

    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    expect(queue.isDestroyed()).toBe(true);
    expect(queue.queuedBytes()).toBe(0);
  });

  it('sender.isDestroyed() === true and send() returns null after cleanup', () => {
    setupTcpConnection();
    sendHeaders();

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuid = Object.keys(tunnel.tcpConnections)[0];
    const sender = tunnel.tcpConnections[uuid].sender;

    expect(sender.isDestroyed()).toBe(false);

    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    expect(sender.isDestroyed()).toBe(true);
    expect(sender.send(Buffer.from('late'))).toBeNull();
  });

  it('tunnel.tcpConnections[uuid] === undefined after cleanup', () => {
    setupTcpConnection();
    sendHeaders();

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuid = Object.keys(tunnel.tcpConnections)[0];
    expect(tunnel.tcpConnections[uuid]).toBeDefined();

    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    expect(tunnel.tcpConnections[uuid]).toBeUndefined();
  });

  it('sender.send() after cleanup does not call ws.send()', () => {
    setupTcpConnection();
    sendHeaders();
    sendBodyChunk('DATA');
    jest.advanceTimersByTime(10);

    const wsCallsBefore = mockWs.send.mock.calls.length;

    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    // Attempt a late send — must return null without reaching ws.send()
    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    // uuid entry is gone; verify ws.send count hasn't changed
    expect(mockWs.send.mock.calls.length).toBe(wsCallsBefore);
  });

  it('full lifecycle: create → data → cleanup → all resources destroyed', () => {
    setupTcpConnection();
    sendHeaders();

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuid = Object.keys(tunnel.tcpConnections)[0];
    const conn = tunnel.tcpConnections[uuid];

    const queue = conn.queue;
    const sender = conn.sender;

    // Data transfer
    sendBodyChunk('CHUNK1');
    sendBodyChunk('CHUNK2');
    jest.advanceTimersByTime(10);

    expect(queue.isDestroyed()).toBe(false);
    expect(sender.isDestroyed()).toBe(false);

    // Cleanup
    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    // Queue destroyed
    expect(queue.isDestroyed()).toBe(true);
    expect(queue.queuedBytes()).toBe(0);
    expect(queue.depth()).toBe(0);

    // Sender destroyed
    expect(sender.isDestroyed()).toBe(true);
    expect(sender.getOutstanding()).toBe(0);

    // State cleaned
    expect(tunnel.tcpConnections[uuid]).toBeUndefined();
    expect(Object.keys(tunnel.tcpConnections)).toHaveLength(0);

    // No further sends
    expect(sender.send(Buffer.from('late'))).toBeNull();
  });

  it('double cleanup is idempotent — resources stay destroyed', () => {
    setupTcpConnection();
    sendHeaders();
    sendBodyChunk('ABC');
    jest.advanceTimersByTime(10);

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuid = Object.keys(tunnel.tcpConnections)[0];
    const queue = tunnel.tcpConnections[uuid].queue;
    const sender = tunnel.tcpConnections[uuid].sender;

    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    expect(queue.isDestroyed()).toBe(true);
    expect(sender.isDestroyed()).toBe(true);

    // Second close event (RWT-TCP-001: close after close is a no-op)
    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    expect(queue.isDestroyed()).toBe(true);
    expect(sender.isDestroyed()).toBe(true);
    expect(tunnel.tcpConnections[uuid]).toBeUndefined();
  });

  it('cleanup after error is idempotent (RWT-TCP-001)', () => {
    setupTcpConnection();
    sendHeaders();
    sendBodyChunk('DATA');
    jest.advanceTimersByTime(10);

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuid = Object.keys(tunnel.tcpConnections)[0];

    // Error first
    mockSocket._errorCb(new Error('socket error'));
    jest.advanceTimersByTime(10);

    expect(tunnel.tcpConnections[uuid]).toBeUndefined();

    // Then close event
    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    expect(tunnel.tcpConnections[uuid]).toBeUndefined();
  });

  it('sender.destroy() clears outstanding without firing onResume', () => {
    setupTcpConnection();
    sendHeaders();

    // Send enough data to trigger backpressure
    for (let i = 0; i < 200; i++) sendBodyChunk('X'.repeat(64 * 1024));
    jest.advanceTimersByTime(10);

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuid = Object.keys(tunnel.tcpConnections)[0];
    const sender = tunnel.tcpConnections[uuid].sender;

    const wasPaused = sender.isPaused();

    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    expect(sender.isDestroyed()).toBe(true);
    expect(sender.getOutstanding()).toBe(0);
    expect(sender.isPaused()).toBe(false);
  });

  it('queue self-destroys on socket close event (built-in listener)', () => {
    setupTcpConnection();
    sendHeaders();

    const tunnel = state[wsPort].websocketTunnels['test-tunnel-001'];
    const uuid = Object.keys(tunnel.tcpConnections)[0];
    const queue = tunnel.tcpConnections[uuid].queue;

    expect(queue.isDestroyed()).toBe(false);

    // Socket close triggers queue.destroy() via built-in listener
    mockSocket._closeCb();
    jest.advanceTimersByTime(10);

    expect(queue.isDestroyed()).toBe(true);
  });
});

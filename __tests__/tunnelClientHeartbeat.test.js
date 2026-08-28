const { EventEmitter } = require('events');
const WebSocket = require('ws');

jest.mock('ws');
jest.mock('../client/utils', () => ({
  buildMessageBuffer: jest.fn((tunnelId, uuid, type, payload) => {
    const uuidBuffer = Buffer.from(uuid || 'test-uuid', 'utf8').slice(0, 36);
    const typeBuffer = Buffer.from([type]);
    const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(uuidBuffer.length + typeBuffer.length + payloadBuffer.length, 0);
    return Buffer.concat([lengthBuffer, uuidBuffer, typeBuffer, payloadBuffer]);
  }),
}));
jest.mock('net', () => ({
  createConnection: jest.fn(() => ({
    on: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
    destroyed: false,
  })),
}));
jest.mock('../package.json', () => ({ version: '1.0.0' }));
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
  setLogContext: jest.fn(),
}));
jest.mock('../utils/tunnelLimits', () => ({
  getTunnelLimits: () => ({
    highWatermarkBytes: 8 * 1024 * 1024,
    lowWatermarkBytes: 2 * 1024 * 1024,
    maxFrameSizeBytes: 1024 * 1024,
    maxBufferPerStreamBytes: 64 * 1024 * 1024,
    maxBufferPerTunnelBytes: 256 * 1024 * 1024,
    maxBufferPerProcessBytes: 512 * 1024 * 1024,
    tcpIdleTimeoutMs: 60000,
  }),
}));
jest.mock('../utils/tunnelMetrics', () => ({
  getMetrics: () => ({
    countFrameTooLarge: jest.fn(),
    registerStream: jest.fn(),
    unregisterStream: jest.fn(),
  }),
}));

function createMockWs() {
  const emitter = new EventEmitter();
  emitter.ping = jest.fn();
  emitter.send = jest.fn();
  emitter.readyState = WebSocket.OPEN;
  emitter.OPEN = WebSocket.OPEN;
  emitter.CLOSED = 3;
  emitter.CLOSE = 3;
  emitter.terminate = jest.fn(() => {
    emitter.readyState = 3;
  });
  return emitter;
}

function setupConnectWs() {
  const ws = createMockWs();
  WebSocket.mockReturnValue(ws);

  const { connectWebSocket } = require('../client/tunnelClient');
  const client = connectWebSocket({
    tunnelId: 'test-tunnel',
    wsUrl: 'ws://test.com',
    targetUrl: 'http://localhost',
    targetPort: 3000,
  });

  // Trigger 'open' to start heartbeat + health monitor
  const openHandlers = ws.listeners('open');
  for (const h of openHandlers) h();

  return { client, ws };
}

function getCloseHandler(ws) {
  return ws.listeners('close')[0];
}

describe('RWT-KNOWN-009 pong listener accumulation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    try {
      require('../client/tunnelClient').resetClients();
    } catch (_) {}
  });

  it('normal pong: clears timeout, does not terminate', () => {
    const { ws } = setupConnectWs();
    jest.advanceTimersByTime(30000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.listenerCount('pong')).toBe(1);

    ws.emit('pong');
    expect(ws.listenerCount('pong')).toBe(0);

    jest.advanceTimersByTime(5000);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it('pong timeout: terminates connection', () => {
    const { ws } = setupConnectWs();
    jest.advanceTimersByTime(30000);
    jest.advanceTimersByTime(5000);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });

  it('pong timeout removes the pong listener', () => {
    const { ws } = setupConnectWs();
    jest.advanceTimersByTime(30000);
    expect(ws.listenerCount('pong')).toBe(1);

    jest.advanceTimersByTime(5000);
    expect(ws.listenerCount('pong')).toBe(0);
  });

  it('max one pong listener at any time across multiple cycles', () => {
    const { ws } = setupConnectWs();

    // Cycle 1: ping → pong → listener removed, no terminate
    jest.advanceTimersByTime(30000);
    expect(ws.listenerCount('pong')).toBe(1);
    ws.emit('pong');
    expect(ws.listenerCount('pong')).toBe(0);
    expect(ws.terminate).not.toHaveBeenCalled();

    // Cycle 2 (new connection to avoid health monitor): ping → timeout → listener removed
    jest.useRealTimers();
    jest.useFakeTimers();
    const { ws: ws2 } = setupConnectWs();
    jest.advanceTimersByTime(30000);
    expect(ws2.listenerCount('pong')).toBe(1);
    jest.advanceTimersByTime(5000);
    expect(ws2.listenerCount('pong')).toBe(0);
    expect(ws2.terminate).toHaveBeenCalledTimes(1);

    // Across both connections: pong listener count never exceeded 1
  });

  it('cleanup on WS close removes pong listener', () => {
    const { ws } = setupConnectWs();
    jest.advanceTimersByTime(30000);
    expect(ws.listenerCount('pong')).toBe(1);

    getCloseHandler(ws)();
    expect(ws.listenerCount('pong')).toBe(0);
  });

  it('late pong after timeout does not affect new cycle', () => {
    const { ws } = setupConnectWs();

    // Cycle 1: ping → timeout
    jest.advanceTimersByTime(30000);
    const terminateCountBeforeTimeout = ws.terminate.mock.calls.length;
    jest.advanceTimersByTime(5000);
    expect(ws.terminate).toHaveBeenCalledTimes(terminateCountBeforeTimeout + 1);

    // Late pong from cycle 1 — no listener registered for it, should not crash
    ws.emit('pong');

    // Verify no additional terminate was triggered by the late pong
    expect(ws.terminate).toHaveBeenCalledTimes(terminateCountBeforeTimeout + 1);
  });
});

describe('RWT-KNOWN-009 reconnect behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    try {
      require('../client/tunnelClient').resetClients();
    } catch (_) {}
  });

  it('reconnect fires once per close', () => {
    const { ws } = setupConnectWs();
    getCloseHandler(ws)();
    jest.advanceTimersByTime(1000);
    expect(WebSocket).toHaveBeenCalledTimes(2);
  });

  it('client.close() suppresses reconnect', () => {
    const { ws, client } = setupConnectWs();
    client.close();
    getCloseHandler(ws)();
    jest.advanceTimersByTime(35000);
    expect(WebSocket).toHaveBeenCalledTimes(1);
  });

  it('health monitor terminates after timeout with no pong', () => {
    const { ws } = setupConnectWs();
    jest.advanceTimersByTime(45000);
    expect(ws.terminate).toHaveBeenCalled();
  });
});

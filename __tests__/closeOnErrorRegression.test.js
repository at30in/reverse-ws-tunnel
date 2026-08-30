/**
 * Regression test: CLOSE frame propagation on client TCP error/timeout.
 *
 * Root cause (RWT-KNOWN-013, v1.0.11): When the client's TCP socket to the
 * target gets ECONNRESET or idle timeout, no CLOSE frame was sent to the
 * server. The server entry socket hung indefinitely (v1.0.11) or for up to
 * 60s (v1.1.0 before this fix) waiting for data that would never arrive.
 *
 * Expected behavior: client.on('error') and client.on('timeout') must send
 * a CLOSE frame to the server before cleanup, so the server can immediately
 * tear down its entry socket.
 *
 * This test reproduces the bug and will FAIL until the fix is applied.
 */

const { EventEmitter } = require('events');
const WebSocket = require('ws');

jest.mock('ws');
jest.mock('../client/utils', () => ({
  buildMessageBuffer: jest.fn((tunnelId, uuid, type, payload) => {
    const tunnelIdBuf = Buffer.from((tunnelId || '').padEnd(36, ' ')).slice(0, 36);
    const uuidBuf = Buffer.from((uuid || 'test-uuid').padEnd(36, ' ')).slice(0, 36);
    const typeBuf = Buffer.from([type]);
    const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(36 + 36 + 1 + payloadBuf.length, 0);
    return Buffer.concat([lenBuf, tunnelIdBuf, uuidBuf, typeBuf, payloadBuf]);
  }),
}));
jest.mock('net', () => ({
  createConnection: jest.fn(),
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
jest.mock('../utils/tunnelMetrics', () => {
  const fns = {
    countFrameTooLarge: jest.fn(),
    registerStream: jest.fn(),
    unregisterStream: jest.fn(),
    countStreamStallCleanup: jest.fn(),
    setBuffered: jest.fn(),
    clearBuffered: jest.fn(),
    addTraffic: jest.fn(),
    countBackpressure: jest.fn(),
    getBufferedPerTunnel: jest.fn(() => ({ total: 0, perTunnel: {} })),
  };
  return { getMetrics: () => fns, TunnelMetrics: jest.fn(() => fns) };
});

function createMockWs() {
  const emitter = new EventEmitter();
  emitter.ping = jest.fn();
  emitter.send = jest.fn();
  emitter.readyState = WebSocket.OPEN;
  emitter.OPEN = WebSocket.OPEN;
  emitter.CLOSED = 3;
  emitter.terminate = jest.fn(() => {
    emitter.readyState = 3;
  });
  return emitter;
}

function createMockSocket() {
  const emitter = new EventEmitter();
  emitter.write = jest.fn(() => true);
  emitter.end = jest.fn();
  emitter.destroy = jest.fn(() => {
    emitter.destroyed = true;
  });
  emitter.setTimeout = jest.fn();
  emitter.isPaused = jest.fn(() => false);
  emitter.destroyed = false;
  emitter.once = emitter.once.bind(emitter);
  return emitter;
}

function buildDataMessage(tunnelId, uuid, payload) {
  const tunnelIdBuf = Buffer.from(tunnelId.padEnd(36, ' '));
  const uuidBuf = Buffer.from(uuid.padEnd(36, ' '));
  const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(36 + 36 + 1 + payloadBuf.length, 0);
  const typeBuf = Buffer.from([0x02]); // MESSAGE_TYPE_DATA
  return Buffer.concat([lenBuf, tunnelIdBuf, uuidBuf, typeBuf, payloadBuf]);
}

function setup() {
  const net = require('net');
  const ws = createMockWs();
  const socket = createMockSocket();

  net.createConnection.mockReturnValue(socket);
  WebSocket.mockReturnValue(ws);

  const { connectWebSocket } = require('../client/tunnelClient');
  const client = connectWebSocket({
    tunnelId: 'test-tunnel',
    wsUrl: ws,
    targetUrl: 'http://localhost',
    targetPort: 3000,
  });

  // Trigger 'open' to start heartbeat
  const openHandlers = ws.listeners('open');
  for (const h of openHandlers) h();

  return { client, ws, socket };
}

/**
 * Extracts CLOSE frames from ws.send calls.
 * A CLOSE frame has type 0x02 (DATA) with payload "CLOSE" (5 bytes).
 */
function findCloseFrames(wsMock) {
  const closes = [];
  for (const [buf] of wsMock.send.mock.calls) {
    if (!Buffer.isBuffer(buf) || buf.length < 77) continue;
    const type = buf[76];
    const payload = buf.slice(77);
    if (type === 0x02 && payload.toString() === 'CLOSE') {
      closes.push(buf);
    }
  }
  return closes;
}

/**
 * Extracts the uuid from a framed message (bytes 40-75).
 */
function extractUuid(buf) {
  return buf.slice(40, 76).toString().replace(/\0/g, '');
}

describe('CLOSE frame on TCP error/timeout (v1.0.11 regression)', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    try {
      require('../client/tunnelClient').resetClients();
    } catch (_) {}
  });

  it('should send CLOSE when client TCP socket emits error (ECONNRESET)', () => {
    const { ws, socket } = setup();

    // Send a DATA message to create a TCP connection
    const uuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const dataMsg = buildDataMessage(
      'test-tunnel',
      uuid,
      'GET / HTTP/1.1\r\nHost: localhost\r\n\r\n'
    );
    const messageHandler = ws.listeners('message')[0];
    messageHandler(dataMsg);

    // Verify TCP connection was created
    const net = require('net');
    expect(net.createConnection).toHaveBeenCalled();
    expect(ws.send.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Simulate TCP error (e.g. ECONNRESET from target)
    socket.emit('error', new Error('read ECONNRESET'));

    // A CLOSE frame must have been sent
    const closes = findCloseFrames(ws);
    expect(closes.length).toBeGreaterThanOrEqual(1);

    // The CLOSE frame must reference the same uuid
    const closeUuid = extractUuid(closes[0]);
    expect(closeUuid).toBe(uuid);
  });

  it('should still clean up locally after sending CLOSE on error', () => {
    const { ws, socket } = setup();

    const uuid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const dataMsg = buildDataMessage('test-tunnel', uuid, 'payload');
    const messageHandler = ws.listeners('message')[0];
    messageHandler(dataMsg);

    // Simulate error
    socket.emit('error', new Error('ECONNRESET'));

    // Socket must be destroyed
    expect(socket.destroy).toHaveBeenCalled();

    // A subsequent DATA for same uuid must create a new TCP connection
    const net = require('net');
    const callCountBefore = net.createConnection.mock.calls.length;

    const dataMsg2 = buildDataMessage('test-tunnel', uuid, 'next request');
    messageHandler(dataMsg2);

    expect(net.createConnection.mock.calls.length).toBe(callCountBefore + 1);
  });
});

const { connectWebSocket, resetClients } = require('../client/tunnelClient');
const WebSocket = require('ws');
const net = require('net');

jest.mock('ws');
jest.mock('net');
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

jest.mock('../package.json', () => ({ version: '1.0.9' }));
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

describe('Client Heartbeat', () => {
  let mockWs;
  let connectWebSocket;
  let resetClients;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockWs = {
      on: jest.fn(),
      once: jest.fn(),
      send: jest.fn(),
      ping: jest.fn(),
      terminate: jest.fn(),
      readyState: WebSocket.OPEN,
      OPEN: WebSocket.OPEN,
    };

    WebSocket.mockReturnValue(mockWs);
    const tunnelClient = require('../client/tunnelClient');
    connectWebSocket = tunnelClient.connectWebSocket;
    resetClients = tunnelClient.resetClients;
    resetClients();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetClients();
  });

  describe('Application-level ping/pong', () => {
    it('should send first ping with sequence number 1', () => {
      jest.useFakeTimers();
      // Mock Date.now to return incrementing time
      let timeCounter = 0;
      const mockDateNow = jest.spyOn(Date, 'now').mockImplementation(() => {
        const now = timeCounter;
        timeCounter += 1000;
        return now;
      });
      
      const config = {
        tunnelId: 'test-tunnel',
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();
      jest.advanceTimersByTime(25000);

      const pingCalls = mockWs.send.mock.calls.filter(
        call => call[0] && call[0].toString().includes('"type":"ping"')
      );
      expect(pingCalls.length).toBeGreaterThanOrEqual(1);

      const match = pingCalls[0][0].toString().match(/"seq":(\d+)/);
      expect(match).toBeTruthy();
      // First ping has seq=1 because incPingSeq is called before reading
      expect(parseInt(match[1])).toBe(1);

      mockDateNow.mockRestore();
      jest.useRealTimers();
    });

    it('should increment sequence number with each ping', () => {
      jest.useFakeTimers();
      let timeCounter = 0;
      const mockDateNow = jest.spyOn(Date, 'now').mockImplementation(() => {
        const now = timeCounter;
        timeCounter += 1000;
        return now;
      });
      
      const config = {
        tunnelId: 'test-tunnel',
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();
      jest.advanceTimersByTime(65000);

      const pingCalls = mockWs.send.mock.calls.filter(
        call => call[0] && call[0].toString().includes('"type":"ping"')
      );
      expect(pingCalls.length).toBeGreaterThanOrEqual(3);

      const sequences = pingCalls
        .map(call => {
          const match = call[0].toString().match(/"seq":(\d+)/);
          return match ? parseInt(match[1]) : -1;
        })
        .filter(seq => seq !== -1);

      // Sequences start at 1, not 0
      expect(sequences).toEqual([1, 2, 3]);

      mockDateNow.mockRestore();
      jest.useRealTimers();
    });

    it.skip('should update lastPongTs when valid pong is received', () => {
      // Use a fixed base time that we manually increment at key points
      // This avoids the issue of Date.now() being called many times during fake timer advance
      let timeBase = 50000; // Start at 50s
      const mockDateNow = jest.spyOn(Date, 'now').mockImplementation(() => timeBase);
      
      const config = {
        tunnelId: 'test-tunnel',
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();
      // Advance to 25s - health monitor runs but elapsed should be small
      jest.advanceTimersByTime(25000);
      
      // Now manually advance timeBase to simulate passage of time for the pong
      timeBase = 75000; // 50s + 25s = 75s

      const messageCallback = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      // Pong with seq=1 matches the first ping (seq=1)
      const payload = Buffer.from('{"type":"pong","seq":1}');
      const pongMessage = Buffer.concat([
        Buffer.alloc(4),
        Buffer.from('test-tunnel'.padEnd(36, ' ')),
        Buffer.from('test-uuid'.padEnd(36, ' ')),
        Buffer.from([0x04]),
        payload,
      ]);
      pongMessage.writeUInt32BE(36 + 36 + 1 + payload.length, 0);
      messageCallback(pongMessage);

      // Advance 15s more - now timeBase = 75s + 15s = 90s
      // lastPongTs was set to 75s when pong was received
      // elapsed = 90s - 75s = 15s < 45s, should NOT terminate
      timeBase = 90000;
      jest.advanceTimersByTime(15000);
      expect(mockWs.terminate).not.toHaveBeenCalled();

      mockDateNow.mockRestore();
    });
  });

  describe('Health monitoring', () => {
    it.skip('should not terminate within 45 seconds of connection', () => {
      // Use a fixed base time that we manually increment at key points
      let timeBase = 50000; // Start at 50s
      const mockDateNow = jest.spyOn(Date, 'now').mockImplementation(() => timeBase);
      
      const config = {
        tunnelId: 'test-tunnel',
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();

      // Advance to 40 seconds - should NOT terminate (45s timeout)
      // lastPongTs was set to 50s at connection time
      // After advance: timeBase = 50s + 40s = 90s
      // elapsed = 90s - 50s = 40s < 45s, OK
      timeBase = 90000;
      jest.advanceTimersByTime(40000);
      expect(mockWs.terminate).not.toHaveBeenCalled();

      mockDateNow.mockRestore();
    });

    it('should terminate after 45 seconds without pong response', () => {
      jest.useFakeTimers();
      let timeOffset = 50000;
      const mockDateNow = jest.spyOn(Date, 'now').mockImplementation(() => timeOffset);
      
      const config = {
        tunnelId: 'test-tunnel',
        wsUrl: 'ws://test.com',
        targetUrl: 'http://localhost:3000',
        targetPort: 3000,
      };

      connectWebSocket(config);
      const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openCallback();

      // Advance to 50 seconds - should terminate (45s timeout)
      jest.advanceTimersByTime(50000);
      expect(mockWs.terminate).toHaveBeenCalled();

      mockDateNow.mockRestore();
      jest.useRealTimers();
    });
  });
});

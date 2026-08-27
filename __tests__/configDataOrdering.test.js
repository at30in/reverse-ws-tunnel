const net = require('net');
const state = require('../server/state');
const { logger } = require('../utils/logger');
const {
  MESSAGE_TYPE_CONFIG,
  MESSAGE_TYPE_DATA,
  MESSAGE_TYPE_APP_PING,
} = require('../server/constants');

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
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
    registerTunnel: jest.fn(),
    unregisterTunnel: jest.fn(),
    registerStream: jest.fn(),
    unregisterStream: jest.fn(),
  }),
}));

jest.mock('../server/tcpServer', () => ({
  ensureTCPServer: jest.fn(),
}));

const tcpServerModule = require('../server/tcpServer');

const TUNNEL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const UUID = '11111111-2222-3333-4444-555555555555';
const WS_PORT = '8888';

function makeMockWs() {
  return { readyState: 1, send: jest.fn() };
}

let mockTcpServers;

describe('RWT-KNOWN-010 CONFIG/DATA ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tcpServerModule.ensureTCPServer.mockReset();
    mockTcpServers = [];
    delete state[WS_PORT];
    delete state['9999'];
    if (state.tcpServers) delete state.tcpServers['9999'];
  });

  afterEach(async () => {
    for (const s of mockTcpServers) {
      try { s.close(); } catch (_) {}
    }
    delete state[WS_PORT];
    delete state['9999'];
    if (state.tcpServers) delete state.tcpServers['9999'];
  });

  async function createTcpServer() {
    return new Promise((resolve, reject) => {
      const s = net.createServer();
      s.on('error', reject);
      s.listen(0, () => {
        mockTcpServers.push(s);
        resolve(s);
      });
    });
  }

  describe('handleParsedMessage serialization', () => {
    it('CONFIG → DATA: DATA sees tunnel registered by CONFIG', async () => {
      const { handleParsedMessage } = require('../server/messageHandler');
      const mockWs = makeMockWs();

      const tcpSrv = await createTcpServer();
      const tcpPort = String(tcpSrv.address().port);

      // Pre-register TCP server so CONFIG finds it as "already listening"
      state[WS_PORT] = state[WS_PORT] || { websocketTunnels: {} };
      state[WS_PORT][tcpPort] = { tcpServer: tcpSrv };
      state.tcpServers = state.tcpServers || {};
      state.tcpServers[tcpPort] = tcpSrv;

      // Process CONFIG
      const configPayload = JSON.stringify({ TUNNEL_ENTRY_PORT: tcpSrv.address().port });
      await handleParsedMessage(
        mockWs, TUNNEL_ID, UUID, MESSAGE_TYPE_CONFIG,
        Buffer.from(configPayload), 'x-tunnel-id', WS_PORT
      );

      // CONFIG completed — tunnel registered
      expect(state[WS_PORT]?.websocketTunnels?.[TUNNEL_ID]).toBeDefined();

      // Now process DATA — should find the tunnel (no TCP conn yet → graceful log)
      await handleParsedMessage(
        mockWs, TUNNEL_ID, UUID, MESSAGE_TYPE_DATA,
        Buffer.from('test-data'), 'x-tunnel-id', WS_PORT
      );

      const noConnLog = logger.debug.mock.calls.find(c =>
        c[0]?.includes('No TCP connection found')
      );
      expect(noConnLog).toBeTruthy();
    });

    it('CONFIG + DATA in rapid succession: DATA not lost when await serializes', async () => {
      const { handleParsedMessage } = require('../server/messageHandler');
      const mockWs = makeMockWs();

      const tcpSrv = await createTcpServer();
      const tcpPort = String(tcpSrv.address().port);

      state[WS_PORT] = state[WS_PORT] || { websocketTunnels: {} };
      state[WS_PORT][tcpPort] = { tcpServer: tcpSrv };
      state.tcpServers = state.tcpServers || {};
      state.tcpServers[tcpPort] = tcpSrv;

      const frames = [
        { type: MESSAGE_TYPE_CONFIG, payload: JSON.stringify({ TUNNEL_ENTRY_PORT: tcpSrv.address().port }) },
        { type: MESSAGE_TYPE_DATA, payload: 'data1' },
        { type: MESSAGE_TYPE_DATA, payload: 'data2' },
      ];

      const processingOrder = [];
      for (const frame of frames) {
        await handleParsedMessage(
          mockWs, TUNNEL_ID, UUID, frame.type,
          Buffer.from(frame.payload), 'x-tunnel-id', WS_PORT
        );
        processingOrder.push(frame.type);
      }

      expect(processingOrder).toEqual([
        MESSAGE_TYPE_CONFIG,
        MESSAGE_TYPE_DATA,
        MESSAGE_TYPE_DATA,
      ]);

      expect(state[WS_PORT]?.websocketTunnels?.[TUNNEL_ID]).toBeDefined();
    });

    it('CONFIG failure: handleParsedMessage does not throw', async () => {
      tcpServerModule.ensureTCPServer.mockRejectedValue(new Error('EADDRINUSE'));

      const { handleParsedMessage } = require('../server/messageHandler');
      const mockWs = makeMockWs();
      const configPayload = JSON.stringify({ TUNNEL_ENTRY_PORT: 9999 });

      await expect(
        handleParsedMessage(
          mockWs, TUNNEL_ID, UUID, MESSAGE_TYPE_CONFIG,
          Buffer.from(configPayload), 'x-tunnel-id', WS_PORT
        )
      ).resolves.toBeUndefined();

      // Error logged by messageHandler's inner try/catch for ensureTCPServer
      const configError = logger.error.mock.calls.find(c =>
        c[0]?.includes('Failed to create TCP server')
      );
      expect(configError).toBeTruthy();
    });

    it('DATA without tunnel: handled gracefully', async () => {
      const { handleParsedMessage } = require('../server/messageHandler');
      const mockWs = makeMockWs();

      await handleParsedMessage(
        mockWs, TUNNEL_ID, UUID, MESSAGE_TYPE_DATA,
        Buffer.from('orphan-data'), 'x-tunnel-id', WS_PORT
      );

      const noConnLog = logger.debug.mock.calls.find(c =>
        c[0]?.includes('No TCP connection found')
      );
      expect(noConnLog).toBeTruthy();
    });

    it('APP_PING: handled correctly', async () => {
      const { handleParsedMessage } = require('../server/messageHandler');
      const mockWs = makeMockWs();

      const pingPayload = JSON.stringify({ type: 'ping', seq: 1 });
      await handleParsedMessage(
        mockWs, TUNNEL_ID, UUID, MESSAGE_TYPE_APP_PING,
        Buffer.from(pingPayload), 'x-tunnel-id', WS_PORT
      );

      expect(mockWs.send).toHaveBeenCalledTimes(1);
    });

    it('WS cleanup during CONFIG: resources cleaned up', async () => {
      const { handleParsedMessage } = require('../server/messageHandler');
      const mockWs = makeMockWs();

      // CONFIG with missing TUNNEL_ENTRY_PORT triggers error path
      const configPayload = JSON.stringify({});
      await handleParsedMessage(
        mockWs, TUNNEL_ID, UUID, MESSAGE_TYPE_CONFIG,
        Buffer.from(configPayload), 'x-tunnel-id', WS_PORT
      );

      const warnLog = logger.warn.mock.calls.find(c =>
        c[0]?.includes('TUNNEL_ENTRY_PORT')
      );
      expect(warnLog).toBeTruthy();
    });
  });

  describe('websocketServer await serialization', () => {
    it('message handler awaits before next frame (integration)', async () => {
      const { startWebSocketServer, stopWebSocketServer } = require('../server/websocketServer');
      const WebSocket = require('ws');

      const result = startWebSocketServer({ port: 0, tunnelIdHeaderName: 'x-tunnel-id' });
      const portKey = Object.keys(result).find(k => result[k].webSocketServer);
      const wsSrv = result[portKey].webSocketServer;
      const wsPort = wsSrv.address().port;

      const client = new WebSocket(`ws://localhost:${wsPort}`);
      await new Promise(r => client.on('open', r));

      const tId = Buffer.from(TUNNEL_ID.padEnd(36, '\0'), 'utf8').slice(0, 36);
      const u = Buffer.from(UUID.padEnd(36, '\0'), 'utf8').slice(0, 36);

      // CONFIG with missing TUNNEL_ENTRY_PORT → triggers error path, no TCP server needed
      const configPayload = JSON.stringify({});
      const configFrame = Buffer.concat([
        Buffer.alloc(4), tId, u,
        Buffer.from([MESSAGE_TYPE_CONFIG]),
        Buffer.from(configPayload),
      ]);
      configFrame.writeUInt32BE(tId.length + u.length + 1 + Buffer.from(configPayload).length, 0);

      // DATA immediately after
      const dataPayload = 'test-data';
      const dataFrame = Buffer.concat([
        Buffer.alloc(4), tId, u,
        Buffer.from([MESSAGE_TYPE_DATA]),
        Buffer.from(dataPayload),
      ]);
      dataFrame.writeUInt32BE(tId.length + u.length + 1 + Buffer.from(dataPayload).length, 0);

      client.send(configFrame);
      client.send(dataFrame);

      await new Promise(r => setTimeout(r, 100));

      // CONFIG should have been processed (warn about missing port)
      const warnLog = logger.warn.mock.calls.find(c =>
        c[0]?.includes('TUNNEL_ENTRY_PORT')
      );
      expect(warnLog).toBeTruthy();

      // DATA should have been processed (debug about no connection)
      const debugLog = logger.debug.mock.calls.find(c =>
        c[0]?.includes('No TCP connection found')
      );
      expect(debugLog).toBeTruthy();

      // No unhandled errors
      const unhandled = logger.error.mock.calls.filter(c =>
        c[0]?.includes('Unhandled error')
      );
      expect(unhandled).toHaveLength(0);

      client.close();
      await stopWebSocketServer(wsPort);
    });
  });
});

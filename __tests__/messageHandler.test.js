const { handleParsedMessage } = require('../server/messageHandler');
const { buildMessageBuffer } = require('../client/utils');
const {
  MESSAGE_TYPE_CONFIG,
  MESSAGE_TYPE_DATA,
  MESSAGE_TYPE_APP_PING,
  MESSAGE_TYPE_APP_PONG,
  MESSAGE_TYPE_CONFIG_RESPONSE,
} = require('../server/constants');
const state = require('../server/state');
const { logger } = require('../utils/logger');
const { version: serverVersion } = require('../package.json');

jest.mock('../server/tcpServer', () => ({
  ensureTCPServer: jest.fn(),
}));

describe('handleParsedMessage', () => {
  const tunnelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const uuid = '11111111-2222-3333-4444-555555555555';
  const tunnelIdHeaderName = 'x-tunnel-id';
  const port = 9999;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset global state
    delete state[port];
  });

  describe('APP_PING with OPEN WebSocket', () => {
    it('sends APP_PONG with correct payload', async () => {
      const mockWs = {
        readyState: 1, // WebSocket.OPEN
        send: jest.fn(),
      };

      const pingData = { seq: 42 };
      const pingPayload = Buffer.from(JSON.stringify(pingData), 'utf8');

      await handleParsedMessage(
        mockWs,
        tunnelId,
        uuid,
        MESSAGE_TYPE_APP_PING,
        pingPayload,
        tunnelIdHeaderName,
        port
      );

      expect(mockWs.send).toHaveBeenCalledTimes(1);

      // Verify the sent buffer is a valid message buffer
      const sentBuf = mockWs.send.mock.calls[0][0];
      expect(Buffer.isBuffer(sentBuf)).toBe(true);

      // Parse the sent buffer
      const declaredLength = sentBuf.readUInt32BE(0);
      const tunnelIdStart = 4;
      const tunnelIdEnd = tunnelIdStart + 36;
      const uuidStart = tunnelIdEnd;
      const uuidEnd = uuidStart + 36;
      const typeByte = sentBuf.readUInt8(uuidEnd);
      const payloadBuf = sentBuf.slice(uuidEnd + 1);

      expect(sentBuf.length).toBe(4 + declaredLength);
      expect(sentBuf.slice(tunnelIdStart, tunnelIdEnd).toString()).toBe(tunnelId);
      expect(sentBuf.slice(uuidStart, uuidEnd).toString()).toBe(uuid);
      expect(typeByte).toBe(MESSAGE_TYPE_APP_PONG);

      const pongData = JSON.parse(payloadBuf.toString());
      expect(pongData.type).toBe('pong');
      expect(pongData.seq).toBe(42);
    });
  });

  describe('APP_PING with non-OPEN WebSocket', () => {
    it('does not call ws.send when readyState is CLOSING', async () => {
      const mockWs = {
        readyState: 2, // WebSocket.CLOSING
        send: jest.fn(),
      };

      const pingData = { seq: 1 };
      const pingPayload = Buffer.from(JSON.stringify(pingData), 'utf8');

      await handleParsedMessage(
        mockWs,
        tunnelId,
        uuid,
        MESSAGE_TYPE_APP_PING,
        pingPayload,
        tunnelIdHeaderName,
        port
      );

      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('does not call ws.send when readyState is CLOSED', async () => {
      const mockWs = {
        readyState: 3, // WebSocket.CLOSED
        send: jest.fn(),
      };

      const pingData = { seq: 1 };
      const pingPayload = Buffer.from(JSON.stringify(pingData), 'utf8');

      await handleParsedMessage(
        mockWs,
        tunnelId,
        uuid,
        MESSAGE_TYPE_APP_PING,
        pingPayload,
        tunnelIdHeaderName,
        port
      );

      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('does not call ws.send when readyState is CONNECTING', async () => {
      const mockWs = {
        readyState: 0, // WebSocket.CONNECTING
        send: jest.fn(),
      };

      const pingData = { seq: 1 };
      const pingPayload = Buffer.from(JSON.stringify(pingData), 'utf8');

      await handleParsedMessage(
        mockWs,
        tunnelId,
        uuid,
        MESSAGE_TYPE_APP_PING,
        pingPayload,
        tunnelIdHeaderName,
        port
      );

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('CONFIG sends CONFIG_RESPONSE', () => {
    it('sends CONFIG_RESPONSE with serverVersion after CONFIG', async () => {
      const mockWs = {
        readyState: 1, // WebSocket.OPEN
        send: jest.fn(),
      };

      const configPayload = Buffer.from(
        JSON.stringify({
          TARGET_URL: 'http://localhost',
          TARGET_PORT: 8080,
          TUNNEL_ENTRY_URL: 'http://localhost',
          TUNNEL_ENTRY_PORT: 9999,
          environment: 'test',
          agentVersion: '1.0.0',
        }),
        'utf8'
      );

      await handleParsedMessage(
        mockWs,
        tunnelId,
        uuid,
        MESSAGE_TYPE_CONFIG,
        configPayload,
        tunnelIdHeaderName,
        port
      );

      expect(mockWs.send).toHaveBeenCalledTimes(1);

      const sentBuf = mockWs.send.mock.calls[0][0];
      expect(Buffer.isBuffer(sentBuf)).toBe(true);

      const declaredLength = sentBuf.readUInt32BE(0);
      const tunnelIdStart = 4;
      const tunnelIdEnd = tunnelIdStart + 36;
      const uuidStart = tunnelIdEnd;
      const uuidEnd = uuidStart + 36;
      const typeByte = sentBuf.readUInt8(uuidEnd);
      const payloadBuf = sentBuf.slice(uuidEnd + 1);

      expect(sentBuf.length).toBe(4 + declaredLength);
      expect(sentBuf.slice(tunnelIdStart, tunnelIdEnd).toString()).toBe(tunnelId);
      expect(sentBuf.slice(uuidStart, uuidEnd).toString()).toBe(uuid);
      expect(typeByte).toBe(MESSAGE_TYPE_CONFIG_RESPONSE);

      const responseData = JSON.parse(payloadBuf.toString());
      expect(responseData.serverVersion).toBe(serverVersion);
    });

    it('does not send CONFIG_RESPONSE when ws.readyState is not OPEN', async () => {
      const mockWs = {
        readyState: 2, // WebSocket.CLOSING
        send: jest.fn(),
      };

      const configPayload = Buffer.from(
        JSON.stringify({
          TARGET_URL: 'http://localhost',
          TARGET_PORT: 8080,
          TUNNEL_ENTRY_URL: 'http://localhost',
          TUNNEL_ENTRY_PORT: 9999,
          environment: 'test',
          agentVersion: '1.0.0',
        }),
        'utf8'
      );

      await handleParsedMessage(
        mockWs,
        tunnelId,
        uuid,
        MESSAGE_TYPE_CONFIG,
        configPayload,
        tunnelIdHeaderName,
        port
      );

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });
});

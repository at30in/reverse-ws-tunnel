const { buildMessageBuffer } = require('../client/utils');

describe('buildMessageBuffer', () => {
  it('should be importable', () => {
    const { buildMessageBuffer } = require('../client/utils');
    expect(typeof buildMessageBuffer).toBe('function');
  });

  it('should create a buffer with basic inputs', () => {
    const { buildMessageBuffer } = require('../client/utils');
    const result = buildMessageBuffer('test-tunnel', 'test-uuid', 0x01, 'test payload');

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should have correct length header', () => {
    const { buildMessageBuffer } = require('../client/utils');
    const result = buildMessageBuffer('a', 'b', 0x01, 'c');

    const length = result.readUInt32BE(0);
    expect(length).toBe(result.length - 4);
  });

  const mockTunnelId = 'test-tunnel-id-123456789012345678901';
  const mockUuid = 'test-uuid-123456789012345678901234567';
  const mockType = 0x01;

  it('should create a buffer with correct structure for string payload', () => {
    const payload = 'test-payload';
    const buffer = buildMessageBuffer(mockTunnelId, mockUuid, mockType, payload);

    expect(Buffer.isBuffer(buffer)).toBe(true);

    // Check length header (first 4 bytes)
    const length = buffer.readUInt32BE(0);
    expect(length).toBe(buffer.length - 4);

    // Check tunnel ID (next 36 bytes if it's a proper UUID, or actual length)
    const tunnelIdFromBuffer = buffer.slice(4, 4 + mockTunnelId.length).toString();
    expect(tunnelIdFromBuffer).toBe(mockTunnelId);

    // Check UUID (next 36 bytes)
    const uuidFromBuffer = buffer.slice(4 + mockTunnelId.length, 4 + mockTunnelId.length + mockUuid.length).toString();
    expect(uuidFromBuffer).toBe(mockUuid);

    // Check type (1 byte)
    const typeFromBuffer = buffer.readUInt8(4 + mockTunnelId.length + mockUuid.length);
    expect(typeFromBuffer).toBe(mockType);

    // Check payload
    const payloadFromBuffer = buffer.slice(4 + mockTunnelId.length + mockUuid.length + 1).toString();
    expect(payloadFromBuffer).toBe(payload);
  });

  it('should handle Buffer payload correctly', () => {
    const payload = Buffer.from('binary-payload-data', 'utf8');
    const buffer = buildMessageBuffer(mockTunnelId, mockUuid, mockType, payload);

    expect(Buffer.isBuffer(buffer)).toBe(true);

    // Extract payload from buffer
    const payloadFromBuffer = buffer.slice(4 + mockTunnelId.length + mockUuid.length + 1);
    expect(Buffer.compare(payloadFromBuffer, payload)).toBe(0);
  });

  it('should create correct length header', () => {
    const payload = 'abc123';
    const buffer = buildMessageBuffer(mockTunnelId, mockUuid, mockType, payload);

    const length = buffer.readUInt32BE(0);
    const expectedLength = mockTunnelId.length + mockUuid.length + 1 + payload.length;
    expect(length).toBe(expectedLength);
  });

  it('should handle empty payload', () => {
    const payload = '';
    const buffer = buildMessageBuffer(mockTunnelId, mockUuid, mockType, payload);

    expect(Buffer.isBuffer(buffer)).toBe(true);

    const length = buffer.readUInt32BE(0);
    const expectedLength = mockTunnelId.length + mockUuid.length + 1; // no payload
    expect(length).toBe(expectedLength);
  });

  it('should handle different message types', () => {
    const payload = 'test';
    const configType = 0x01;
    const dataType = 0x02;

    const configBuffer = buildMessageBuffer(mockTunnelId, mockUuid, configType, payload);
    const dataBuffer = buildMessageBuffer(mockTunnelId, mockUuid, dataType, payload);

    const configTypeFromBuffer = configBuffer.readUInt8(4 + mockTunnelId.length + mockUuid.length);
    const dataTypeFromBuffer = dataBuffer.readUInt8(4 + mockTunnelId.length + mockUuid.length);

    expect(configTypeFromBuffer).toBe(configType);
    expect(dataTypeFromBuffer).toBe(dataType);
  });

  it('should handle large payloads', () => {
    const largePayload = 'x'.repeat(10000);
    const buffer = buildMessageBuffer(mockTunnelId, mockUuid, mockType, largePayload);

    expect(Buffer.isBuffer(buffer)).toBe(true);

    const length = buffer.readUInt32BE(0);
    const expectedLength = mockTunnelId.length + mockUuid.length + 1 + largePayload.length;
    expect(length).toBe(expectedLength);

    const payloadFromBuffer = buffer.slice(4 + mockTunnelId.length + mockUuid.length + 1).toString();
    expect(payloadFromBuffer).toBe(largePayload);
  });
});

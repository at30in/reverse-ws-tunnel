const { buildMessageBuffer } = require('../client/utils');

describe('buildMessageBuffer', () => {
  const tunnelId = 'test-tunnel-id';
  const uuid = 'test-uuid';

  it('should create a buffer with correct structure for string payload', () => {
    const type = 0x01;
    const payload = 'test-payload';
    const buffer = buildMessageBuffer(tunnelId, uuid, type, payload);

    const expectedLength = tunnelId.length + uuid.length + 1 + payload.length;
    expect(buffer.readUInt32BE(0)).toBe(expectedLength);
    expect(buffer.slice(4, 4 + tunnelId.length).toString()).toBe(tunnelId);
    expect(buffer.slice(4 + tunnelId.length, 4 + tunnelId.length + uuid.length).toString()).toBe(
      uuid
    );
    expect(buffer.readUInt8(4 + tunnelId.length + uuid.length)).toBe(type);
    expect(buffer.slice(4 + tunnelId.length + uuid.length + 1).toString()).toBe(payload);
  });

  it('should handle Buffer payload correctly', () => {
    const type = 0x02;
    const payload = Buffer.from('buffer-payload');
    const buffer = buildMessageBuffer(tunnelId, uuid, type, payload);

    const expectedLength = tunnelId.length + uuid.length + 1 + payload.length;
    expect(buffer.readUInt32BE(0)).toBe(expectedLength);
    expect(buffer.slice(4 + tunnelId.length + uuid.length + 1).toString()).toBe('buffer-payload');
  });

  it('should handle empty payload', () => {
    const type = 0x03;
    const payload = '';
    const buffer = buildMessageBuffer(tunnelId, uuid, type, payload);

    const expectedLength = tunnelId.length + uuid.length + 1;
    expect(buffer.readUInt32BE(0)).toBe(expectedLength);
    expect(buffer.length).toBe(4 + expectedLength);
  });

  it('should have correct length header', () => {
    const type = 0x01;
    const payload = 'some-data';
    const buffer = buildMessageBuffer(tunnelId, uuid, type, payload);
    const expectedLength = tunnelId.length + uuid.length + 1 + payload.length;
    expect(buffer.readUInt32BE(0)).toBe(expectedLength);
  });
});

const { buildMessageBuffer } = require('../utils');

describe('buildMessageBuffer', () => {
  it('should return a buffer with correct structure (string payload)', () => {
    const buffer = buildMessageBuffer('tunnel-id-123', 'uuid-456', 0x01, 'test-payload');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('should handle payloads as Buffers correctly', () => {
    const bufferPayload = Buffer.from('payload-data');
    const buffer = buildMessageBuffer('tunnel-id', 'uuid', 0x02, bufferPayload);
    expect(buffer.includes(bufferPayload)).toBe(true);
  });

  it('should write correct length in header', () => {
    const payload = 'abc';
    const buffer = buildMessageBuffer('a', 'b', 0x01, payload);
    const length = buffer.readUInt32BE(0);
    expect(length).toBe(buffer.length - 4);
  });
});

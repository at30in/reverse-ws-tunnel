const { FrameParser, FrameSizeError } = require('../utils/frameParser');
const { buildMessageBuffer } = require('../client/utils');

const TUNNEL = 'a'.repeat(36);
const UUID = 'b'.repeat(36);

function frame(type, payload) {
  return buildMessageBuffer(TUNNEL, UUID, type, payload);
}

describe('FrameParser', () => {
  it('parses a single complete frame from one chunk', () => {
    const parser = new FrameParser();
    const msg = frame(0x02, Buffer.from('hello'));
    const frames = parser.push(msg);

    expect(frames).toHaveLength(1);
    expect(frames[0].tunnelId).toBe(TUNNEL);
    expect(frames[0].uuid).toBe(UUID);
    expect(frames[0].type).toBe(0x02);
    expect(frames[0].payload.toString()).toBe('hello');
    expect(frames[0].declaredLength).toBe(73 + 5);
    expect(parser.tail).toBeNull();
  });

  it('parses multiple frames packed into one chunk', () => {
    const parser = new FrameParser();
    const chunk = Buffer.concat([
      frame(0x02, Buffer.from('one')),
      frame(0x03, Buffer.from('{}')),
      frame(0x01, Buffer.alloc(0)),
    ]);
    const frames = parser.push(chunk);

    expect(frames.map(f => f.type)).toEqual([0x02, 0x03, 0x01]);
    expect(frames[2].payload.length).toBe(0); // zero-payload frame
    expect(parser.tail).toBeNull();
  });

  it('reassembles a frame delivered byte-by-byte without re-concat history', () => {
    const parser = new FrameParser();
    const msg = frame(0x04, Buffer.from(JSON.stringify({ type: 'pong', seq: 1 })));

    let frames = [];
    for (const [i, byte] of Object.entries(msg)) {
      frames = parser.push(Buffer.from([byte]));
      const isLast = Number(i) === msg.length - 1;
      expect(frames).toHaveLength(isLast ? 1 : 0);
    }
    expect(frames[0].type).toBe(0x04);
    expect(JSON.parse(frames[0].payload.toString())).toEqual({ type: 'pong', seq: 1 });
    expect(parser.push(Buffer.alloc(0))).toHaveLength(0);
  });

  it('handles arbitrary chunk splits (header split included)', () => {
    const parser = new FrameParser();
    const msgA = frame(0x02, Buffer.from('AAAA'));
    const msgB = frame(0x02, Buffer.from('BBBBBB'));

    expect(parser.push(msgA.subarray(0, 2))).toHaveLength(0); // splits length prefix
    expect(parser.push(msgA.subarray(2))).toHaveLength(1);
    expect(parser.push(Buffer.concat([msgB.subarray(0, 40), msgB.subarray(40)]))).toHaveLength(1);
  });

  it('keeps a partial tail and resumes cleanly across pushes', () => {
    const parser = new FrameParser();
    const msg = frame(0x02, Buffer.from('x'.repeat(100)));
    const cut = 50;

    expect(parser.push(msg.subarray(0, cut))).toHaveLength(0);
    const frames = parser.push(msg.subarray(cut));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.length).toBe(100);
    expect(parser.tail).toBeNull();
  });

  it('rejects oversized declared length BEFORE allocating the payload', () => {
    const parser = new FrameParser({ maxFrameSizeBytes: 1024 * 1024 });

    const evil = Buffer.allocUnsafe(8);
    evil.writeUInt32BE(0xffffffff, 0); // absurd declared size
    evil.writeUInt32BE(10, 4);

    expect(() => parser.push(evil)).toThrow(FrameSizeError);
    try {
      parser.push(evil);
    } catch (err) {
      expect(err.declaredLength).toBe(0xffffffff);
      expect(err.maxFrameSizeBytes).toBe(1024 * 1024);
    }
  });

  it('accepts a frame exactly at the configured limit', () => {
    const parser = new FrameParser({ maxFrameSizeBytes: 73 + 4 });
    expect(parser.push(frame(0x02, Buffer.alloc(4)))).toHaveLength(1);
  });

  it('is byte-compatible with legacy buildMessageBuffer output round-trip', () => {
    // Legacy wire sample produced by the pre-optimization builder:
    const tunnelBuf = Buffer.from(TUNNEL);
    const uuidBuf = Buffer.from(UUID);
    const payload = Buffer.from('legacy');
    const totalLength = tunnelBuf.length + uuidBuf.length + 1 + payload.length;
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(totalLength);
    const legacyWire = Buffer.concat([
      lengthBuffer,
      tunnelBuf,
      uuidBuf,
      Buffer.from([0x02]),
      payload,
    ]);

    const parser = new FrameParser();
    const [decoded] = parser.push(legacyWire);
    expect(decoded.tunnelId).toBe(TUNNEL);
    expect(decoded.uuid).toBe(UUID);
    expect(decoded.type).toBe(0x02);
    expect(decoded.payload.equals(payload)).toBe(true);
  });

  it('reset() clears partial state between connections', () => {
    const parser = new FrameParser();
    parser.push(frame(0x02, Buffer.from('partial')).subarray(0, 10));
    expect(parser.tail).not.toBeNull();

    parser.reset();
    expect(parser.tail).toBeNull();

    const [f] = parser.push(frame(0x01, Buffer.from('{}')));
    expect(f.type).toBe(0x01);
  });

  it('returns [] for empty chunks', () => {
    const parser = new FrameParser();
    expect(parser.push(Buffer.alloc(0))).toEqual([]);
    expect(parser.push(null)).toEqual([]);
  });
});

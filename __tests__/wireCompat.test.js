/**
 * Wire-format compatibility tests (no network required):
 *
 *  - FrameParser correctly reassembles frames even when TCP chunks
 *    split mid-frame, at field boundaries, or byte-by-byte.
 *  - Oversize declared length is rejected without allocating the buffer.
 *  - buildMessageBuffer ↔ FrameParser round-trip produces the exact
 *    original payloads.
 */
const crypto = require('crypto');
const { FrameParser, FrameSizeError } = require('../utils/frameParser');
const { buildMessageBuffer } = require('../client/utils');
const { getTunnelLimits } = require('../utils/tunnelLimits');

describe('wire format compatibility', () => {
  const tunnelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const uuid = '11111111-2222-3333-4444-555555555555';

  /** Feed data byte-by-byte; should still produce correct frames. */
  function parseByteByByte(buffer) {
    const parser = new FrameParser();
    const frames = [];
    for (let i = 0; i < buffer.length; i++) {
      frames.push(...parser.push(Buffer.from([buffer[i]])));
    }
    return frames;
  }

  test('single DATA frame round-trips through byte-by-byte parsing', () => {
    const payload = Buffer.from('hello, world!');
    const raw = buildMessageBuffer(tunnelId, uuid, 0x02, payload);
    const frames = parseByteByByte(raw);
    expect(frames).toHaveLength(1);
    expect(frames[0].tunnelId).toBe(tunnelId);
    expect(frames[0].uuid).toBe(uuid);
    expect(frames[0].type).toBe(0x02);
    expect(frames[0].payload.equals(payload)).toBe(true);
  });

  test('three frames in one chunk, split at random offsets', () => {
    const payloads = [Buffer.from('aaa'), crypto.randomBytes(100), Buffer.from('end')];
    const bufs = payloads.map(p => buildMessageBuffer(tunnelId, uuid, 0x02, p));
    const combined = Buffer.concat(bufs);

    // Split at fixed offsets.
    const splits = [10, 50, 77, 100, 140].filter(s => s < combined.length);
    let prev = 0;
    const chunks = [];
    for (const s of splits) {
      chunks.push(combined.subarray(prev, s));
      prev = s;
    }
    chunks.push(combined.subarray(prev));

    const parser = new FrameParser();
    const frames = [];
    for (const c of chunks) frames.push(...parser.push(c));

    expect(frames).toHaveLength(3);
    frames.forEach((f, i) => {
      expect(f.payload.equals(payloads[i])).toBe(true);
      expect(f.tunnelId).toBe(tunnelId);
    });
  });

  test('oversize declared length throws FrameSizeError before allocating', () => {
    const maxFrame = getTunnelLimits().maxFrameSizeBytes;
    const header = Buffer.alloc(4);
    header.writeUInt32BE(maxFrame + 1024, 0);
    const junk = Buffer.alloc(64, 0xab);
    const raw = Buffer.concat([header, junk]);

    const parser = new FrameParser({ maxFrameSizeBytes: maxFrame });
    expect(() => parser.push(raw)).toThrow(FrameSizeError);
  });

  test('multiple frame types in a single push', () => {
    const p1 = buildMessageBuffer(tunnelId, uuid, 0x02, Buffer.from('data'));
    const p2 = buildMessageBuffer(tunnelId, uuid, 0x05, Buffer.from('CLOSE'));
    const parser = new FrameParser();
    const frames = parser.push(Buffer.concat([p1, p2]));

    expect(frames).toHaveLength(2);
    expect(frames[0].type).toBe(0x02);
    expect(frames[0].payload.toString()).toBe('data');
    expect(frames[1].type).toBe(0x05);
    expect(frames[1].payload.toString()).toBe('CLOSE');
  });

  test('CONFIG frame (type 0x01) round-trips byte-by-byte', () => {
    const config = Buffer.from('TARGET_PORT=4444,ENTRY_PORT=5555');
    const raw = buildMessageBuffer(tunnelId, uuid, 0x01, config);
    const frames = parseByteByByte(raw);
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe(0x01);
    expect(frames[0].payload.toString()).toBe(config.toString());
  });

  test('large payload (256 KB) splits cleanly across many chunks', () => {
    const payload = crypto.randomBytes(256 * 1024);
    const raw = buildMessageBuffer(tunnelId, uuid, 0x02, payload);

    // Split every 100 bytes — most chunks land mid-header.
    const chunks = [];
    for (let i = 0; i < raw.length; i += 100) {
      chunks.push(raw.subarray(i, Math.min(i + 100, raw.length)));
    }

    const parser = new FrameParser();
    const frames = [];
    for (const c of chunks) frames.push(...parser.push(c));

    expect(frames).toHaveLength(1);
    expect(frames[0].payload.equals(payload)).toBe(true);
    expect(frames[0].payload.length).toBe(256 * 1024);
  });
});

const { DEFAULT_LIMITS, ENV_KEYS, getTunnelLimits } = require('../utils/tunnelLimits');

const M = 1024 * 1024;

describe('tunnelLimits', () => {
  const CLEAN_ENV = { ...process.env };
  beforeEach(() => {
    for (const envName of Object.values(ENV_KEYS)) {
      delete process.env[envName];
    }
  });
  afterAll(() => {
    process.env = CLEAN_ENV;
  });

  it('returns frozen defaults when nothing is configured', () => {
    const limits = getTunnelLimits();
    expect(limits.highWatermarkBytes).toBe(8 * M);
    expect(limits.lowWatermarkBytes).toBe(2 * M);
    expect(limits.maxFrameSizeBytes).toBe(M);
    expect(limits.maxBufferPerStreamBytes).toBe(64 * M);
    expect(limits.maxBufferPerTunnelBytes).toBe(256 * M);
    expect(limits.maxBufferPerProcessBytes).toBe(512 * M);
    expect(limits.tcpIdleTimeoutMs).toBe(60000);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it('applies RWT_* environment overrides', () => {
    process.env.RWT_HIGH_WATERMARK = String(16 * M);
    process.env.RWT_MAX_FRAME_SIZE = '4096';
    const limits = getTunnelLimits();
    expect(limits.highWatermarkBytes).toBe(16 * M);
    expect(limits.maxFrameSizeBytes).toBe(4096);
    expect(limits.lowWatermarkBytes).toBe(2 * M); // default untouched
  });

  it('programmatic overrides win over env', () => {
    process.env.RWT_LOW_WATERMARK = '1024';
    const limits = getTunnelLimits({ lowWatermarkBytes: 2048 });
    expect(limits.lowWatermarkBytes).toBe(2048);
  });

  it('throws on non-numeric or non-positive values', () => {
    process.env.RWT_HIGH_WATERMARK = 'abc';
    expect(() => getTunnelLimits()).toThrow(/RWT_HIGH_WATERMARK/);

    process.env.RWT_HIGH_WATERMARK = '-5';
    expect(() => getTunnelLimits()).toThrow(/RWT_HIGH_WATERMARK/);

    delete process.env.RWT_HIGH_WATERMARK;
    expect(() => getTunnelLimits({ maxFrameSizeBytes: 0 })).toThrow(/maxFrameSize/);
  });

  it('enforces low < high and stream <= tunnel invariants', () => {
    expect(() => getTunnelLimits({ lowWatermarkBytes: 10 * M, highWatermarkBytes: 8 * M })).toThrow(
      /lowWatermark/
    );

    expect(() =>
      getTunnelLimits({
        maxBufferPerStreamBytes: 64 * M,
        maxBufferPerTunnelBytes: 32 * M,
      })
    ).toThrow(/maxBufferPerStream/);
  });

  it('ignores empty-string env values', () => {
    process.env.RWT_HIGH_WATERMARK = '';
    expect(getTunnelLimits().highWatermarkBytes).toBe(DEFAULT_LIMITS.highWatermarkBytes);
  });
});

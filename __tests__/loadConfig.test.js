const { loadConfig } = require('../utils/loadConfig');
const fs = require('fs');
const toml = require('@iarna/toml');
const path = require('path');

jest.mock('fs');
jest.mock('@iarna/toml');

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('should load configuration from environment variables', () => {
    process.env.TUNNEL_ID = 'env-tunnel-id';
    process.env.WS_URL = 'env-ws-url';
    fs.existsSync.mockReturnValue(false);

    const config = loadConfig();

    expect(config.tunnelId).toBe('env-tunnel-id');
    expect(config.wsUrl).toBe('env-ws-url');
  });

  it('should load configuration from config.toml file', () => {
    const tomlConfig = { tunnelId: 'toml-tunnel-id', wsUrl: 'toml-ws-url' };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('toml content');
    toml.parse.mockReturnValue(tomlConfig);

    const config = loadConfig();

    expect(config.tunnelId).toBe('toml-tunnel-id');
    expect(config.wsUrl).toBe('toml-ws-url');
  });

  it('should prioritize config.toml over environment variables', () => {
    process.env.TUNNEL_ID = 'env-tunnel-id';
    const tomlConfig = { tunnelId: 'toml-tunnel-id' };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('toml content');
    toml.parse.mockReturnValue(tomlConfig);

    const config = loadConfig();

    expect(config.tunnelId).toBe('toml-tunnel-id');
  });

  it('should handle missing config.toml gracefully', () => {
    fs.existsSync.mockReturnValue(false);
    const config = loadConfig();
    expect(config).toBeDefined();
  });

  it('should handle TOML parsing error gracefully', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('invalid toml');
    toml.parse.mockImplementation(() => {
      throw new Error('Invalid TOML');
    });

    const config = loadConfig();
    expect(config).toBeDefined();
  });

  it('should load config from a custom path', () => {
    const customPath = '/custom/path';
    const expectedPath = path.join(customPath, 'config.toml');
    fs.existsSync.mockReturnValue(false);

    loadConfig(customPath);

    expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);
  });
});

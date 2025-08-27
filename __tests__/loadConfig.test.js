const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../utils/loadConfig');

// Mock the logger to avoid console output during tests
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock fs module
jest.mock('fs');

// Mock TOML parser
const mockTOMLParse = jest.fn();
jest.mock('@iarna/toml', () => ({
  parse: mockTOMLParse,
}));

describe('loadConfig', () => {
  const originalEnv = process.env;
  const originalRequireMain = require.main;

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv };

    // Clear all mocks
    jest.clearAllMocks();

    // Mock require.main
    require.main = {
      path: '/test/path',
    };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    require.main = originalRequireMain;
  });

  describe('Environment variable loading', () => {
    it('should load configuration from environment variables', () => {
      // Set up environment variables
      process.env.TUNNEL_ID = 'test-tunnel-id';
      process.env.WS_URL = 'wss://example.com/tunnel';
      process.env.TARGET_URL = 'http://localhost:3000';
      process.env.TUNNEL_ENTRY_URL = 'http://localhost:4443';
      process.env.TUNNEL_ENTRY_PORT = '4443';
      process.env.HEADERS = '{"Authorization": "Bearer token"}';
      process.env.ALLOW_INSICURE_CERTS = 'true';
      process.env.LOG_LEVEL = 'debug';

      // Mock no config file
      fs.existsSync.mockReturnValue(false);

      const config = loadConfig();

      expect(config).toEqual({
        tunnelId: 'test-tunnel-id',
        wsUrl: 'wss://example.com/tunnel',
        targetUrl: 'http://localhost:3000',
        tunnelEntryUrl: 'http://localhost:4443',
        tunnelEntryPort: 4443,
        headers: '{"Authorization": "Bearer token"}',
        allowInsicuereCerts: true,
        logLevel: 'debug',
      });
    });

    it('should handle missing environment variables', () => {
      // Clear environment variables
      delete process.env.TUNNEL_ID;
      delete process.env.WS_URL;
      delete process.env.TARGET_URL;
      delete process.env.TUNNEL_ENTRY_URL;
      delete process.env.TUNNEL_ENTRY_PORT;
      delete process.env.HEADERS;
      delete process.env.ALLOW_INSICURE_CERTS;
      delete process.env.LOG_LEVEL;

      // Mock no config file
      fs.existsSync.mockReturnValue(false);

      const config = loadConfig();

      expect(config).toEqual({
        tunnelId: undefined,
        wsUrl: undefined,
        targetUrl: undefined,
        tunnelEntryUrl: undefined,
        tunnelEntryPort: undefined,
        headers: undefined,
        allowInsicuereCerts: false,
        logLevel: 'info',
      });
    });

    it('should convert TUNNEL_ENTRY_PORT to number', () => {
      process.env.TUNNEL_ENTRY_PORT = '8080';
      fs.existsSync.mockReturnValue(false);

      const config = loadConfig();

      expect(config.tunnelEntryPort).toBe(8080);
      expect(typeof config.tunnelEntryPort).toBe('number');
    });

    it('should handle boolean conversion for ALLOW_INSICURE_CERTS', () => {
      // Test true value
      process.env.ALLOW_INSICURE_CERTS = 'true';
      fs.existsSync.mockReturnValue(false);

      let config = loadConfig();
      expect(config.allowInsicuereCerts).toBe(true);

      // Test false value
      process.env.ALLOW_INSICURE_CERTS = 'false';
      config = loadConfig();
      expect(config.allowInsicuereCerts).toBe(false);

      // Test undefined value
      delete process.env.ALLOW_INSICURE_CERTS;
      config = loadConfig();
      expect(config.allowInsicuereCerts).toBe(false);
    });

    it('should default LOG_LEVEL to info', () => {
      delete process.env.LOG_LEVEL;
      fs.existsSync.mockReturnValue(false);

      const config = loadConfig();

      expect(config.logLevel).toBe('info');
    });
  });

  describe('TOML file loading', () => {
    it('should load configuration from TOML file', () => {
      const mockTomlConfig = {
        tunnelId: 'toml-tunnel-id',
        wsUrl: 'wss://toml.example.com/tunnel',
        targetUrl: 'http://localhost:8080',
        logLevel: 'trace',
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('mock toml content');
      mockTOMLParse.mockReturnValue(mockTomlConfig);

      const config = loadConfig();

      expect(fs.readFileSync).toHaveBeenCalledWith('/test/path/config.toml', 'utf8');
      expect(mockTOMLParse).toHaveBeenCalledWith('mock toml content');

      // TOML config should override env config
      expect(config.tunnelId).toBe('toml-tunnel-id');
      expect(config.wsUrl).toBe('wss://toml.example.com/tunnel');
      expect(config.targetUrl).toBe('http://localhost:8080');
      expect(config.logLevel).toBe('trace');
    });

    it('should handle TOML file read errors', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });

      // Should not throw and should fall back to env vars
      expect(() => loadConfig()).not.toThrow();
    });

    it('should handle TOML parse errors', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid toml content');
      mockTOMLParse.mockImplementation(() => {
        throw new Error('TOML parse error');
      });

      // Should not throw and should fall back to env vars
      expect(() => loadConfig()).not.toThrow();
    });

    it('should use process.cwd() when require.main.path is not available', () => {
      require.main = null;

      const originalCwd = process.cwd;
      process.cwd = jest.fn(() => '/current/working/dir');

      fs.existsSync.mockReturnValue(false);

      loadConfig();

      expect(process.cwd).toHaveBeenCalled();
      expect(fs.existsSync).toHaveBeenCalledWith('/current/working/dir/config.toml');

      process.cwd = originalCwd;
    });
  });

  describe('Configuration merging', () => {
    it('should merge TOML config over environment config', () => {
      // Set environment variables
      process.env.TUNNEL_ID = 'env-tunnel-id';
      process.env.WS_URL = 'wss://env.example.com/tunnel';
      process.env.LOG_LEVEL = 'info';

      // Mock TOML config that partially overrides env
      const mockTomlConfig = {
        tunnelId: 'toml-tunnel-id', // Override
        targetUrl: 'http://localhost:9000', // New value
        // wsUrl not specified, should use env value
        // logLevel not specified, should use env value
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('mock toml content');
      mockTOMLParse.mockReturnValue(mockTomlConfig);

      const config = loadConfig();

      expect(config.tunnelId).toBe('toml-tunnel-id'); // From TOML
      expect(config.wsUrl).toBe('wss://env.example.com/tunnel'); // From env
      expect(config.targetUrl).toBe('http://localhost:9000'); // From TOML
      expect(config.logLevel).toBe('info'); // From env
    });

    it('should handle complex TOML structures', () => {
      const mockTomlConfig = {
        tunnelId: 'complex-tunnel-id',
        headers: {
          Authorization: 'Bearer toml-token',
          'X-Custom-Header': 'custom-value',
        },
        nested: {
          config: {
            value: 'test',
          },
        },
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('mock toml content');
      mockTOMLParse.mockReturnValue(mockTomlConfig);

      const config = loadConfig();

      expect(config.tunnelId).toBe('complex-tunnel-id');
      expect(config.headers).toEqual({
        Authorization: 'Bearer toml-token',
        'X-Custom-Header': 'custom-value',
      });
      expect(config.nested).toEqual({
        config: {
          value: 'test',
        },
      });
    });
  });

  describe('File path handling', () => {
    it('should use correct config file path', () => {
      require.main = {
        path: '/custom/app/path',
      };

      fs.existsSync.mockReturnValue(false);

      loadConfig();

      expect(fs.existsSync).toHaveBeenCalledWith('/custom/app/path/config.toml');
    });

    it('should handle paths with trailing slashes', () => {
      require.main = {
        path: '/path/with/trailing/slash/',
      };

      fs.existsSync.mockReturnValue(false);

      loadConfig();

      // path.join should handle this correctly
      expect(fs.existsSync).toHaveBeenCalledWith('/path/with/trailing/slash/config.toml');
    });
  });
});

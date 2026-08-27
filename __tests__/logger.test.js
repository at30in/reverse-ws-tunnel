const { logger, initLogger, setLogLevel, getLogLevel, dispose } = require('../utils/logger');
const fs = require('fs');
const toml = require('@iarna/toml');
const path = require('path');

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  watchFile: jest.fn(),
  unwatchFile: jest.fn(),
}));
jest.mock('@iarna/toml');

describe('Logger', () => {
  afterEach(() => {
    dispose();
    jest.clearAllMocks();
  });

  describe('setLogLevel and getLogLevel', () => {
    it('should set and get the log level', () => {
      setLogLevel('debug');
      expect(getLogLevel()).toBe('debug');
    });

    it('should not set an invalid log level', () => {
      const initialLevel = getLogLevel();
      setLogLevel('invalid-level');
      expect(getLogLevel()).toBe(initialLevel);
    });
  });

  describe('initLogger', () => {
    it('should initialize with default config path and load config', () => {
      fs.readFileSync.mockReturnValue('logLevel = "info"');
      toml.parse.mockReturnValue({ logLevel: 'info' });
      initLogger();
      const expectedPath = path.join(process.cwd(), 'config.toml');
      expect(fs.readFileSync).toHaveBeenCalledWith(expectedPath, 'utf8');
    });

    it('should initialize with custom file path', () => {
      const customPath = '/custom/path/config.toml';
      fs.statSync.mockReturnValue({ isFile: () => true, isDirectory: () => false });
      initLogger(customPath);
      expect(fs.statSync).toHaveBeenCalledWith(path.resolve(customPath));
    });

    it('should initialize with custom directory path', () => {
      const customPath = '/custom/dir';
      fs.statSync.mockReturnValue({ isFile: () => false, isDirectory: () => true });
      initLogger(customPath);
      expect(fs.statSync).toHaveBeenCalledWith(path.resolve(customPath));
    });

    it('should handle invalid custom path', () => {
      const customPath = '/invalid/path';
      fs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });
      initLogger(customPath);
      // Expect a warning to be logged, but we are not testing logger output here
    });
  });

  describe('loadConfigFromFile', () => {
    it('should load log level from config file', () => {
      const configContent = 'logLevel = "debug"';
      const parsedConfig = { logLevel: 'debug' };
      fs.readFileSync.mockReturnValue(configContent);
      toml.parse.mockReturnValue(parsedConfig);
      fs.statSync.mockReturnValue({ isFile: () => true, isDirectory: () => false });

      initLogger(); // This will call loadConfigFromFile

      expect(fs.readFileSync).toHaveBeenCalled();
      expect(toml.parse).toHaveBeenCalledWith(configContent);
      expect(getLogLevel()).toBe('debug');
    });

    it('should handle file read error', () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });
      fs.statSync.mockReturnValue({ isFile: () => true, isDirectory: () => false });

      const initialLevel = getLogLevel();
      initLogger();
      expect(getLogLevel()).toBe(initialLevel);
    });

    it('should handle TOML parse error', () => {
      fs.readFileSync.mockReturnValue('invalid toml');
      toml.parse.mockImplementation(() => {
        throw new Error('Invalid TOML');
      });
      fs.statSync.mockReturnValue({ isFile: () => true, isDirectory: () => false });

      const initialLevel = getLogLevel();
      initLogger();
      expect(getLogLevel()).toBe(initialLevel);
    });
  });

  describe('RWT-KNOWN-003 watcher cleanup', () => {
    it('should not accumulate watchers when initLogger is called multiple times', () => {
      fs.readFileSync.mockReturnValue('logLevel = "info"');
      toml.parse.mockReturnValue({ logLevel: 'info' });

      initLogger('/tmp/a');
      initLogger('/tmp/b');
      initLogger('/tmp/c');

      // Each call should add one watcher (3 total)
      expect(fs.watchFile).toHaveBeenCalledTimes(3);

      // But the previous watcher should be removed before adding a new one
      // After 3 calls: watch(a), unwatch(a)+watch(b), unwatch(b)+watch(c)
      // So unwatchFile should be called at least 2 times for previous files
      expect(fs.unwatchFile).toHaveBeenCalled();
      const unwatchedPaths = fs.unwatchFile.mock.calls.map(c => c[0]);
      expect(unwatchedPaths).toContain(path.resolve('/tmp/a'));
      expect(unwatchedPaths).toContain(path.resolve('/tmp/b'));
    });

    it('should call unwatchFile on previous path before watching new path', () => {
      fs.readFileSync.mockReturnValue('logLevel = "info"');
      toml.parse.mockReturnValue({ logLevel: 'info' });

      // First call: no previous watcher
      initLogger('/tmp/first');
      expect(fs.unwatchFile).not.toHaveBeenCalled();

      // Second call: should unwatch first before watching second
      fs.unwatchFile.mockClear();
      initLogger('/tmp/second');
      expect(fs.unwatchFile).toHaveBeenCalledTimes(1);
      expect(fs.unwatchFile).toHaveBeenCalledWith(path.resolve('/tmp/first'));
    });
  });
});

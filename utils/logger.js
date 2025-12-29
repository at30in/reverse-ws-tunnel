// logger.js
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const TOML = require('@iarna/toml');
const FILE_CONFIG_NAME = 'config.toml';

let configFilePath = null;
let logContext = null; // Can be set to 'CLIENT', 'SERVER', or any custom prefix

const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    trace: 'magenta',
  },
};

winston.addColors(customLevels.colors);

const logger = winston.createLogger({
  levels: customLevels.levels,
  level: 'info',
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf((info) => {
          const contextPrefix = logContext ? `${logContext} | ` : '';
          // Get the raw level (before colorization)
          const rawLevel = info[Symbol.for('level')] || info.level;
          // Apply color to level and message separately
          const colorizer = winston.format.colorize();
          const coloredLevel = colorizer.colorize(rawLevel, rawLevel);
          const coloredMessage = colorizer.colorize(rawLevel, `${contextPrefix}${info.message}`);
          return `[${info.timestamp}] ${coloredLevel}: ${coloredMessage}`;
        })
      ),
    }),
  ],
});

function setLogLevel(level) {
  level = level || 'info';
  if (!(level in customLevels.levels)) {
    logger.warn(`Invalid log level: ${level}`);
    return;
  }
  logger.level = level;
  logger.info(`Log level changed to: ${level}`);
}

function getLogLevel() {
  return logger.level;
}

function setLogContext(context) {
  logContext = context;
  if (context) {
    logger.info(`Log context set to: ${context}`);
  }
}

function getLogContext() {
  return logContext;
}

function loadConfigFromFile() {
  try {
    const content = fs.readFileSync(configFilePath, 'utf8');
    const parsed = TOML.parse(content);
    // const parsed = JSON.parse(content);
    if (parsed.logLevel) {
      setLogLevel(parsed.logLevel);
    }
  } catch (err) {
    logger.warn(`Could not read or parse ${configFilePath}: ${err.message}`);
  }
}

function watchLogConfig() {
  fs.watchFile(configFilePath, { interval: 1000 }, (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
      logger.debug('Detected change in log configuration file.');
      loadConfigFromFile();
    }
  });
}

function initLogger(customPath = null) {
  if (customPath) {
    const resolvedPath = path.resolve(customPath);
    try {
      const stats = fs.statSync(resolvedPath);
      if (stats.isFile()) {
        configFilePath = resolvedPath;
      } else if (stats.isDirectory()) {
        configFilePath = path.join(resolvedPath, FILE_CONFIG_NAME);
      } else {
        logger.warn(`Invalid config path provided: ${resolvedPath}`);
        return;
      }
    } catch (err) {
      logger.warn(`Cannot access config path: ${resolvedPath} (${err.message})`);
      return;
    }
  } else {
    const baseDir = require.main?.path || process.cwd();
    configFilePath = path.join(baseDir, FILE_CONFIG_NAME);
  }

  logger.debug(`Logger will read config from: ${configFilePath}`);

  loadConfigFromFile();
  watchLogConfig();
}

// initLogger();

module.exports = {
  logger,
  initLogger,
  setLogLevel,
  getLogLevel,
  setLogContext,
  getLogContext,
};

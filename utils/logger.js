// logger.js
const winston = require('winston');
const fs = require('fs');
const path = require('path');
let configFilePath = path.join(__dirname + './../', 'log.config.json');

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
        winston.format.colorize({ all: true }),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] ${level}: ${message}`;
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

function loadConfigFromFile() {
  try {
    const content = fs.readFileSync(configFilePath, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed.level) {
      setLogLevel(parsed.level);
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

function initLogger(options = {}) {
  if (options.configPath) {
    configFilePath = path.resolve(options.configPath);
  } else {
    const callerDir = require.main?.path || process.cwd();
    const candidate = path.join(callerDir, 'log.config.json');
    if (fs.existsSync(candidate)) {
      configFilePath = candidate;
    }
  }

  logger.debug(`Logger config file: ${configFilePath}`);
  loadConfigFromFile();
  watchLogConfig();
}

initLogger();

// function initLogger(options = {}) {
//   if (options.configPath) {
//     configFilePath = path.resolve(options.configPath);
//     logger.debug(`Using external log config: ${configFilePath}`);
//   }

//   loadConfigFromFile();
//   watchLogConfig();
// }

module.exports = {
  logger,
  initLogger,
  setLogLevel,
  getLogLevel,
};

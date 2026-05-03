const { setLogLevel, getLogLevel, setLogContext, getLogContext, logger } = require('./logger.js');
const { loadConfig } = require('./loadConfig.js');

module.exports = {
  setLogLevel,
  getLogLevel,
  setLogContext,
  getLogContext,
  logger,
  loadConfig,
};

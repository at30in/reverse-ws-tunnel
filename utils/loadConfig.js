const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { logger } = require('./logger');
const FILE_CONFIG_NAME = 'config.toml';
const TOML = require('@iarna/toml');

function loadConfig() {
  const callerDir = require.main?.path || process.cwd();
  const configPath = path.join(callerDir, FILE_CONFIG_NAME);

  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      fileConfig = TOML.parse(content);
      logger.info(`✅ Loaded configuration from config.toml at: ${configPath}`);
      logger.debug(`Parsed config.toml content: ${JSON.stringify(fileConfig, null, 2)}`);
    } catch (err) {
      logger.warn(`⚠️ Failed to parse config.toml at ${configPath}: ${err.message}`);
    }
  } else {
    logger.info(`ℹ️ No config.toml found at: ${configPath}, falling back to environment variables.`);
  }

  const envConfig = {
    tunnelId: process.env.TUNNEL_ID,
    wsUrl: process.env.WS_URL,
    targetUrl: process.env.TARGET_URL,
    tunnelEntryUrl: process.env.TUNNEL_ENTRY_URL,
    tunnelEntryPort: process.env.TUNNEL_ENTRY_PORT ? Number(process.env.TUNNEL_ENTRY_PORT) : undefined,
    headers: process.env.HEADERS,
    allowInsicuereCerts: process.env.ALLOW_INSICURE_CERTS === 'true',
    logLevel: process.env.LOG_LEVEL || 'info',
  };

  logger.trace(`Loaded env config: ${JSON.stringify(envConfig, null, 2)}`);

  const finalConfig = {
    ...envConfig,
    ...fileConfig, // config.toml has priority over .env
  };

  logger.debug(`Merged final configuration: ${JSON.stringify(finalConfig, null, 2)}`);

  return finalConfig;
}

module.exports = { loadConfig };

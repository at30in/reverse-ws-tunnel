require('dotenv').config();
const { startClient } = require('reverse-ws-tunnel/client');
const { loadConfig } = require('reverse-ws-tunnel/utils');

const config = loadConfig();

const client = startClient({
  targetUrl: config.targetUrl,
  allowInsicureCerts: config.allowInsicureCerts,
  wsUrl: config.wsUrl,
  tunnelId: config.tunnelId,
  tunnelEntryUrl: config.tunnelEntryUrl,
  tunnelEntryPort: Number(config.tunnelEntryPort),
  headers: config.headers,
  environment: config.environment,
});

client.on('connected', () => {
  console.log('Client connected to tunnel');
});

client.on('disconnected', () => {
  console.log('Client disconnected from tunnel');
});

// Example of closing the connection
// setTimeout(() => {
//   console.log('Closing client...');
//   client.close();
// }, 10000);

require('dotenv').config();
const { startClient } = require('@remotelinker/reverse-ws-tunnel/client');
const { loadConfig } = require('@remotelinker/reverse-ws-tunnel/utils');

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

client.on('serverVersion', (version) => {
  console.log(`Server version: ${version}`);
});

client.on('command', ({ command, args }) => {
  console.log(`[CLIENT] Received command: ${command}`, args);

  if (command === 'kill') {
    console.log(`[CLIENT] Kill received! Exiting with signal ${args.signal || 'SIGTERM'}. Goodbye!`);
    process.exit(0);
  }
});

// Example of closing the connection
// setTimeout(() => {
//   console.log('Closing client...');
//   client.close();
// }, 10000);

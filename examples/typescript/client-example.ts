// examples/typescript/client-example.ts
import { startClient } from '../../client/index.mjs';

const client = startClient({
  tunnelId: '550e8400-e29b-41d4-a716-446655440000',
  wsUrl: 'wss://your-tunnel-server.com/tunnel',
  targetUrl: 'http://localhost:3000',
  tunnelEntryPort: 4443,
  allowInsicureCerts: false,
  headers: {
    'Authorization': 'Bearer your-token',
    'X-API-Key': 'your-api-key'
  },
  environment: 'development',
  autoReconnect: true
});

// TypeScript should recognize the events
client.on('connected', () => {
  console.log('Client connected to tunnel');
});

client.on('disconnected', () => {
  console.log('Client disconnected from tunnel');
});

client.on('error', (error: Error) => {
  console.error('Client error:', error.message);
});

// Close connection after 10 seconds
setTimeout(() => {
  console.log('Closing client...');
  client.close();
}, 10000);
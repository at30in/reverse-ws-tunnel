#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 Running websocket-tunnel tests with proper cleanup...\n');

// Set environment variables for testing
process.env.NODE_ENV = 'test';

const jestArgs = [
  '--config',
  'jest.config.js',
  '--detectOpenHandles',
  '--forceExit',
  '--verbose',
  '--maxWorkers=1',
];

// Add any command line arguments passed to this script
const additionalArgs = process.argv.slice(2);
jestArgs.push(...additionalArgs);

const jest = spawn('npx', ['jest', ...jestArgs], {
  stdio: 'inherit',
  cwd: process.cwd(),
});

let testTimeout;

// Set a maximum timeout for all tests
testTimeout = setTimeout(() => {
  console.log('\n⚠️ Tests are taking too long, forcing exit...');
  jest.kill('SIGKILL');
  process.exit(1);
}, 60000); // 60 seconds max

jest.on('close', code => {
  clearTimeout(testTimeout);

  if (code === 0) {
    console.log('\n✅ All tests completed successfully!');
  } else {
    console.log(`\n❌ Tests failed with exit code ${code}`);
  }

  // Force exit to prevent hanging
  setTimeout(() => {
    process.exit(code);
  }, 1000);
});

jest.on('error', err => {
  clearTimeout(testTimeout);
  console.error('\n❌ Failed to start Jest:', err);
  process.exit(1);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n⚠️ Received interrupt signal, cleaning up...');
  clearTimeout(testTimeout);
  jest.kill('SIGTERM');
  setTimeout(() => {
    process.exit(1);
  }, 2000);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️ Received termination signal, cleaning up...');
  clearTimeout(testTimeout);
  jest.kill('SIGTERM');
  setTimeout(() => {
    process.exit(1);
  }, 2000);
});

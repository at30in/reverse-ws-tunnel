const http = require('http');
const { sendCommand } = require('./messageHandler');
const { logger } = require('../utils/logger');

/**
 * Creates an HTTP API server for sending commands to tunnel agents.
 * @param {number} wsPort - The WebSocket server port to look up tunnels.
 * @param {number} apiPort - The port to listen on for HTTP API requests.
 * @returns {http.Server} The HTTP server instance.
 */
function createHttpApi(wsPort, apiPort) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === `/api/tunnel/command`) {
      let body = '';

      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          const { tunnelId, command, args } = JSON.parse(body);

          if (!tunnelId || !command) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing tunnelId or command' }));
            return;
          }

          const sent = sendCommand(wsPort, tunnelId, command, args || {});

          if (sent) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Tunnel not found or not connected' }));
          }
        } catch (err) {
          logger.error(`HTTP API error: ${err.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(apiPort, () => {
    logger.info(`HTTP API listening on port ${apiPort}`);
  });

  return server;
}

module.exports = { createHttpApi };

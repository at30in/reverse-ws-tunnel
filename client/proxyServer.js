const http = require('http');
const httpProxy = require('http-proxy');
const { logger } = require('../utils/logger');

/**
 * Starts an HTTP/WebSocket proxy server to forward to the target URL.
 * @param {string} targetUrl - The URL to forward requests to.
 * @param {boolean} allowInsecureCerts - If true, allows self-signed certs.
 * @returns {number} - The port the proxy is listening on.
 */
function startHttpProxyServer(targetUrl, allowInsecureCerts = false) {
  logger.info('Starting HTTP/WS proxy server...');
  logger.debug(`Target URL: ${targetUrl}`);
  logger.debug(`Allow insecure certs: ${allowInsecureCerts}`);

  const proxy = httpProxy.createProxyServer({});

  const server = http.createServer((req, res) => {
    logger.trace(`Incoming HTTP request: ${req.method} ${req.url}`);

    if (!targetUrl) {
      logger.warn('Request received without targetUrl set');
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing TARGET_URL');
    }

    proxy.web(req, res, { target: targetUrl, changeOrigin: true, secure: !allowInsecureCerts }, (err) => {
      logger.error('Proxy web error:', err);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad gateway');
      } else {
        res.end();
      }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    logger.trace(`Incoming WebSocket upgrade: ${req.url}`);
    proxy.ws(req, socket, head, { target: targetUrl, changeOrigin: false, secure: !allowInsecureCerts }, (err) => {
      logger.error('Proxy WS upgrade error:', err);
      socket.end();
    });
  });

  proxy.on('error', (err, req, res) => {
    logger.error('Proxy internal error:', err);
    if (res && !res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Proxy error');
    }
  });

  server.listen(0, () => {
    const port = server.address().port;
    logger.info(`Proxy server is listening on port ${port}`);
  });

  return server.address().port;
}

module.exports = {
  startHttpProxyServer,
};

const http = require('http');
const httpProxy = require('http-proxy');

/**
 * Starts an HTTP/WebSocket proxy server to forward to the target URL.
 * @param {string} targetUrl - The URL to forward requests to.
 * @returns {number} - The port the proxy is listening on.
 */
function startHttpProxyServer(targetUrl) {
  const proxy = httpProxy.createProxyServer({});
  const server = http.createServer((req, res) => {
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing TARGET_URL');
    }

    proxy.web(req, res, { target: targetUrl, changeOrigin: true, secure: true }, (err) => {
      console.error('Proxy error:', err);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad gateway');
      } else {
        res.end();
      }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    proxy.ws(req, socket, head, { target: targetUrl, changeOrigin: false, secure: false });
  });

  proxy.on('error', (err, req, res) => {
    console.error('Proxy error:', err);
    if (res && !res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Proxy error');
    }
  });

  server.listen(0, () => {
    console.log(`Proxy server listening on port ${server.address().port}`);
  });

  return server.address().port;
}

module.exports = {
  startHttpProxyServer,
};

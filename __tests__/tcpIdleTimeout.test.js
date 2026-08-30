/**
 * Regression tests for TCP idle timeout removal.
 *
 * TCP idle timeouts on entry and target sockets have been REMOVED to support
 * slow-responding services (e.g. SAP Business One) where response times can
 * exceed the previous 60s default.
 *
 * Reliance for detecting dead connections:
 *  - TCP error/close events (ECONNRESET, FIN)
 *  - WS ping/pong heartbeat (server terminates dead tunnels)
 *  - Client-side stream health check (stalled sender detection)
 *  - CLOSE frame propagation via onSendError + error/timeout handlers
 *
 * The streamStallCleanup metric remains valid for the client-side heartbeat
 * stall detection (uses ws.bufferedAmount + lastProgress, not socket timeout).
 */

const net = require('net');
const { getTunnelLimits } = require('../utils/tunnelLimits');

jest.useRealTimers();

describe('TCP idle timeout removed', () => {
  describe('server-side entry socket', () => {
    it('should NOT call socket.setTimeout on entry socket', () => {
      const originalCreateServer = net.createServer;

      const mockSocket = {
        on: jest.fn((event, cb) => {
          if (event === 'close') mockSocket._closeCb = cb;
          if (event === 'error') mockSocket._errorCb = cb;
          if (event === 'data') mockSocket._dataCb = cb;
          if (event === 'end') mockSocket._endCb = cb;
          return mockSocket;
        }),
        once: jest.fn(),
        destroy: jest.fn(),
        write: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        setTimeout: jest.fn(),
        isPaused: jest.fn(() => false),
        destroyed: false,
        address: () => ({ port: 3001 }),
      };

      const mockServer = {
        listen: jest.fn((opts, cb) => {
          if (typeof cb === 'function') cb();
        }),
        on: jest.fn(),
        address: () => ({ port: 3001 }),
      };

      net.createServer = jest.fn((optsOrCb, maybeCb) => {
        const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
        cb(mockSocket);
        return mockServer;
      });

      try {
        const state = require('../server/state');
        const wsPort = 9999;
        const tcpPort = 3001;
        const portKey = String(wsPort);

        state[portKey] = state[portKey] || {};
        state[portKey].websocketTunnels = state[portKey].websocketTunnels || {};
        state[portKey].websocketTunnels['test-tunnel'] = {
          ws: { readyState: 1, send: jest.fn() },
          tcpConnections: {},
        };

        const { startTCPServer } = require('../server/tcpServer');
        startTCPServer(tcpPort, 'x-tunnel-id', wsPort);

        expect(mockSocket.setTimeout).not.toHaveBeenCalled();

        // Verify no timeout handler is registered
        const timeoutHandler = mockSocket.on.mock.calls.find(c => c[0] === 'timeout');
        expect(timeoutHandler).toBeUndefined();

        // Cleanup
        delete state[portKey];
      } finally {
        net.createServer = originalCreateServer;
      }
    });
  });
});

describe('streamStallCleanup metric', () => {
  it('countStreamStallCleanup increments the counter', () => {
    const { TunnelMetrics } = require('../utils/tunnelMetrics');
    const metrics = new TunnelMetrics();

    expect(metrics.snapshot().stream_stall_cleanup_total).toBe(0);
    metrics.countStreamStallCleanup();
    metrics.countStreamStallCleanup();
    expect(metrics.snapshot().stream_stall_cleanup_total).toBe(2);
  });

  it('reset clears streamStallCleanupTotal', () => {
    const { TunnelMetrics } = require('../utils/tunnelMetrics');
    const metrics = new TunnelMetrics();

    metrics.countStreamStallCleanup();
    metrics.countStreamStallCleanup();
    metrics.reset();
    expect(metrics.snapshot().stream_stall_cleanup_total).toBe(0);
  });
});

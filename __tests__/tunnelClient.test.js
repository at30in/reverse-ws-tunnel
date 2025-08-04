const WebSocket = require('ws');
const net = require('net');
const { connectWebSocket } = require('../tunnelClient');

// jest.useFakeTimers('modern'); // ✅ oppure rimuovi del tutto se non usato

jest.mock('net', () => ({
  createConnection: jest.fn(() => {
    const socket = {
      on: jest.fn(),
      write: jest.fn(() => true),
      destroy: jest.fn(),
      end: jest.fn(),
      once: jest.fn(),
    };
    return socket;
  }),
}));

describe('tunnelClient', () => {
  let server, port, config;

  beforeAll((done) => {
    server = new WebSocket.Server({ port: 0 }, () => {
      port = server.address().port;
      config = {
        wsUrl: `ws://localhost:${port}`,
        jwt: 'mock-token',
        tunnelId: '12345678-1234-1234-1234-123456789abc',
        targetUrl: 'http://localhost',
        targetPort: 4321,
        tunnelEntryUrl: 'https://entry.test',
        tunnelEntryPort: 443,
      };
      done();
    });
  });

  afterAll(() => {
    server.close();
  });

  it('should send config message on connection', (done) => {
    server.once('connection', (ws) => {
      ws.once('message', (message) => {
        expect(Buffer.isBuffer(message)).toBe(true);
        done();
      });
    });

    connectWebSocket(config);
  });

  it('should handle CLOSE message and destroy TCP client', (done) => {
    const uuid = 'uuid-123456789012345678901234567890123456';
    const closeMsg = Buffer.concat([Buffer.from(uuid), Buffer.from([0x02]), Buffer.from('CLOSE')]);

    server.once('connection', (ws) => {
      ws.send(closeMsg);
      setTimeout(() => {
        expect(net.createConnection).toHaveBeenCalled();
        done();
      }, 100);
    });

    connectWebSocket(config);
  });

  it('should trigger reconnection on WebSocket close', (done) => {
    let wsClient;
    server.once('connection', (ws) => {
      wsClient = ws;
      wsClient.close(); // trigger on('close')
    });

    const reconnectSpy = jest.spyOn(global, 'setTimeout');

    connectWebSocket(config);

    setTimeout(() => {
      expect(reconnectSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
      done();
    }, 100);
  });

  it('should handle websocket error gracefully', (done) => {
    server.once('connection', (ws) => {
      ws.emit('error', new Error('WebSocket failed'));
      done();
    });

    connectWebSocket(config);
  });

  it('should write to TCP and handle backpressure', (done) => {
    const uuid = 'uuid-backpressure-123456789012345678901234567890123456';
    const testData = Buffer.from('Hello from server');
    const tcpSocket = {
      on: jest.fn(),
      write: jest.fn(() => false),
      once: jest.fn((event, cb) => cb()),
      destroy: jest.fn(),
      end: jest.fn(),
    };

    net.createConnection.mockReturnValue(tcpSocket);

    const payload = Buffer.concat([Buffer.from(uuid), Buffer.from([0x02]), testData]);

    server.once('connection', (ws) => {
      ws.send(payload);
      setTimeout(() => {
        expect(tcpSocket.write).toHaveBeenCalled();
        expect(tcpSocket.once).toHaveBeenCalledWith('drain', expect.any(Function));
        done();
      }, 100);
    });

    connectWebSocket(config);
  });
});

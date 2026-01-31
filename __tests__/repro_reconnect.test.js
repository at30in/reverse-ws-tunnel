const { connectWebSocket } = require('../client/tunnelClient');
const WebSocket = require('ws');
const net = require('net');

jest.mock('ws');
jest.mock('net');
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
}));

describe('Reconnection Logic', () => {
  let mockWs;
  let mockTcpSocket;
  let connectWebSocket;
  let resetClients;
  let WebSocketMock; // Declared here

  beforeEach(() => {
    jest.resetModules();
    WebSocketMock = require('ws'); // Assigned here
    const net = require('net');

    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      ping: jest.fn(),
      terminate: jest.fn(),
      readyState: WebSocketMock.OPEN, // Used WebSocketMock
    };
    WebSocketMock.mockReturnValue(mockWs); // Used WebSocketMock

    mockTcpSocket = {
      on: jest.fn(),
      once: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    net.createConnection.mockReturnValue(mockTcpSocket);

    ({ connectWebSocket, resetClients } = require('../client/tunnelClient'));
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (resetClients) resetClients();
  });

  it('should NOT reconnect if close() is called', () => {
    jest.useFakeTimers();
    const config = { tunnelId: 'test-tunnel', wsUrl: 'ws://test.com' };
    const client = connectWebSocket(config);

    // Simulate connection open
    const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
    openCallback();

    // Call close
    client.close();

    // Verify terminate was called
    expect(mockWs.terminate).toHaveBeenCalled();

    // Simulate close event
    const closeCallback = mockWs.on.mock.calls.find(call => call[0] === 'close')[1];
    closeCallback();

    // Fast forward time
    jest.advanceTimersByTime(10000);

    // Verify NO new connection attempt (WebSocket constructor called only once)
    expect(WebSocketMock).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('should reconnect if close() is NOT called', () => {
    jest.useFakeTimers();
    const config = { tunnelId: 'test-tunnel', wsUrl: 'ws://test.com' };
    connectWebSocket(config);

    // Simulate connection open
    const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
    openCallback();

    // Simulate close event WITHOUT calling client.close()
    const closeCallback = mockWs.on.mock.calls.find(call => call[0] === 'close')[1];
    closeCallback();

    // Fast forward time
    jest.advanceTimersByTime(6000);

    // Verify NEW connection attempt
    expect(WebSocketMock).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('should NOT reconnect if autoReconnect is false', () => {
    jest.useFakeTimers();
    const config = { tunnelId: 'test-tunnel', wsUrl: 'ws://test.com', autoReconnect: false };
    connectWebSocket(config);

    // Simulate connection open
    const openCallback = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
    openCallback();

    // Simulate close event WITHOUT calling client.close()
    const closeCallback = mockWs.on.mock.calls.find(call => call[0] === 'close')[1];
    closeCallback();

    // Fast forward time
    jest.advanceTimersByTime(10000);

    // Verify NO new connection attempt
    expect(WebSocketMock).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});

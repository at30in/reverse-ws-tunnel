module.exports = {
  // Global registry of all TCP servers created (keyed by TCP port)
  // This is used to track and close TCP servers that may not be in the main state yet
  tcpServers: {},
};

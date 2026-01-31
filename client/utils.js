/**
 * Builds a binary message buffer.
 * @param {string} tunnelId
 * @param {string} uuid
 * @param {number} type
 * @param {Buffer|string} payload
 * @returns {Buffer}
 */
function buildMessageBuffer(tunnelId, uuid, type, payload) {
  const tunnelBuffer = Buffer.from(tunnelId);
  const uuidBuffer = Buffer.from(uuid);
  const typeBuffer = Buffer.from([type]);
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');

  const totalLength =
    tunnelBuffer.length + uuidBuffer.length + typeBuffer.length + payloadBuffer.length;
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(totalLength);

  return Buffer.concat([lengthBuffer, tunnelBuffer, uuidBuffer, typeBuffer, payloadBuffer]);
}

module.exports = {
  buildMessageBuffer,
};

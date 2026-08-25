/**
 * Builds a binary message buffer.
 *
 * Layout: [4B length (BE)] [tunnelId utf8] [uuid utf8] [1B type] [payload]
 * where length = tunnelId.length + uuid.length + 1 + payload.length.
 *
 * Single allocation with inline writes — avoids the five separate
 * Buffer.from calls plus Buffer.concat of the previous implementation,
 * cutting per-message allocations ~6x on the hot data path.
 *
 * NOTE: strings are written with their actual byte length (no padding);
 * this is byte-identical to the historical wire format.
 *
 * @param {string} tunnelId
 * @param {string} uuid
 * @param {number} type
 * @param {Buffer|string} payload
 * @returns {Buffer}
 */
function buildMessageBuffer(tunnelId, uuid, type, payload) {
  const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const tunnelBytes = Buffer.byteLength(tunnelId, 'utf8');
  const uuidBytes = Buffer.byteLength(uuid, 'utf8');
  const totalLength = tunnelBytes + uuidBytes + 1 + payloadBuf.length;

  const buf = Buffer.allocUnsafe(4 + totalLength);
  buf.writeUInt32BE(totalLength, 0);
  buf.write(tunnelId, 4, tunnelBytes, 'utf8');
  buf.write(uuid, 4 + tunnelBytes, uuidBytes, 'utf8');
  buf.writeUInt8(type, 4 + tunnelBytes + uuidBytes);
  payloadBuf.copy(buf, 4 + tunnelBytes + uuidBytes + 1);

  return buf;
}

module.exports = {
  buildMessageBuffer,
};

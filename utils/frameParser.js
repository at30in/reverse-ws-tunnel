/**
 * Incremental wire-format frame parser.
 *
 * Frame layout on the wire (unchanged, byte-compatible with the legacy
 * Buffer.concat-based readers):
 *
 *   [4B totalLength (BE)] [totalLength bytes of message]
 *
 * where the message is: [tunnelId utf8][uuid utf8][1B type][payload...]
 * and totalLength therefore equals payload.length + 73 when the ids are
 * standard UUID strings.
 *
 * The parser keeps only the minimal incomplete tail between calls — it
 * never re-concatenates the whole accumulated history, so per-message
 * cost is O(frame) instead of O(total transferred).
 */

const HEADER_PREFIX_LENGTH = 4;
const MESSAGE_HEADER_LENGTH = 73; // 36 tunnelId + 36 uuid + 1 type

/** Raised before any allocation when a frame declares an illegal size. */
class FrameSizeError extends Error {
  constructor(declaredLength, maxFrameSizeBytes) {
    super(`invalid frame size: declared ${declaredLength} bytes > limit ${maxFrameSizeBytes}`);
    this.name = 'FrameSizeError';
    this.declaredLength = declaredLength;
    this.maxFrameSizeBytes = maxFrameSizeBytes;
  }
}

/**
 * @param {Buffer} buf buffer containing a full message starting at offset
 * @param {number} offset offset of the message (right after the length prefix)
 * @param {number} totalLength value of the length prefix
 */
function decodeMessage(buf, offset, totalLength) {
  const start = offset;
  const end = offset + totalLength;
  // Payload is copied so the caller can retain it without pinning the
  // underlying network chunk's memory pool.
  const payload = Buffer.from(buf.subarray(start + MESSAGE_HEADER_LENGTH, end));
  return {
    tunnelId: buf.toString('utf8', start, start + 36),
    uuid: buf.toString('utf8', start + 36, start + 72),
    type: buf.readUInt8(start + 72),
    payload,
    declaredLength: totalLength,
  };
}

class FrameParser {
  /**
   * @param {object} [options]
   * @param {number} options.maxFrameSizeBytes reject frames whose declared
   *        totalLength exceeds this BEFORE allocating anything.
   */
  constructor({ maxFrameSizeBytes = Number.MAX_SAFE_INTEGER } = {}) {
    this.maxFrameSizeBytes = maxFrameSizeBytes;
    this.tail = null; // only the incomplete remainder of the last chunk
  }

  /** Drops any buffered partial frame (call on connection teardown). */
  reset() {
    this.tail = null;
  }

  /**
   * Feeds one raw chunk and returns every complete frame it contains.
   * @param {Buffer} chunk
   * @returns {Array<{tunnelId:string, uuid:string, type:number, payload:Buffer, declaredLength:number}>}
   * @throws {FrameSizeError} synchronously, before allocating the payload
   */
  push(chunk) {
    const frames = [];
    if (!chunk || chunk.length === 0) return frames;

    let buf = chunk;
    let owned = false; // true once `buf` is our own merged copy
    if (this.tail) {
      buf = Buffer.concat([this.tail, chunk]);
      this.tail = null;
      owned = true;
    }

    let offset = 0;
    for (;;) {
      const remaining = buf.length - offset;

      if (remaining < HEADER_PREFIX_LENGTH) {
        this._stash(buf, offset, owned);
        break;
      }

      const totalLength = buf.readUInt32BE(offset);
      if (totalLength > this.maxFrameSizeBytes) {
        // Leave internal state untouched: the framing of this connection
        // is unrecoverable; caller must close it in a controlled way.
        throw new FrameSizeError(totalLength, this.maxFrameSizeBytes);
      }

      if (remaining < HEADER_PREFIX_LENGTH + totalLength) {
        this._stash(buf, offset, owned);
        break;
      }

      frames.push(decodeMessage(buf, offset + HEADER_PREFIX_LENGTH, totalLength));
      offset += HEADER_PREFIX_LENGTH + totalLength;

      if (remaining === HEADER_PREFIX_LENGTH + totalLength) {
        this.tail = null;
        break;
      }
    }

    return frames;
  }

  _stash(buf, offset, owned) {
    const rest = buf.length - offset;
    if (rest <= 0) {
      this.tail = null;
    } else if (owned && offset === 0) {
      this.tail = buf; // already our own copy
    } else {
      this.tail = Buffer.from(buf.subarray(offset));
    }
  }
}

module.exports = {
  FrameParser,
  FrameSizeError,
  HEADER_PREFIX_LENGTH,
  MESSAGE_HEADER_LENGTH,
};

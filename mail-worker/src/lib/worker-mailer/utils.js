export class BlockingQueue {
  constructor() {
    this.values = [];
    this.resolvers = [];
  }

  enqueue(value) {
    if (!this.resolvers.length) {
      this.addWrapper();
    }
    this.resolvers.shift()(value);
  }

  async dequeue() {
    if (!this.values.length) {
      this.addWrapper();
    }
    return this.values.shift();
  }

  get length() {
    return this.values.length;
  }

  clear() {
    this.values = [];
    this.resolvers = [];
  }

  addWrapper() {
    this.values.push(
      new Promise(resolve => {
        this.resolvers.push(resolve);
      }),
    );
  }
}

export async function execTimeout(promise, ms, e) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(e), ms)),
  ]);
}

const encoder = new TextEncoder();
export function encode(data) {
  return encoder.encode(data);
}
const decoder = new TextDecoder('utf-8');
export function decode(data) {
  return decoder.decode(data);
}

export function encodeQuotedPrintable(text, lineLength = 76) {
  const bytes = encode(text);
  let result = '';
  let currentLineLength = 0;
  let i = 0;

  while (i < bytes.length) {
    const byte = bytes[i];
    let encoded;

    if (byte === 0x0a) {
      result += '\r\n';
      currentLineLength = 0;
      i++;
      continue;
    } else if (byte === 0x0d) {
      if (i + 1 < bytes.length && bytes[i + 1] === 0x0a) {
        result += '\r\n';
        currentLineLength = 0;
        i += 2;
        continue;
      } else {
        encoded = '=0D';
      }
    }

    if (encoded === undefined) {
      const isWhitespace = byte === 0x20 || byte === 0x09;
      const nextIsLineBreak =
        i + 1 >= bytes.length || bytes[i + 1] === 0x0a || bytes[i + 1] === 0x0d;

      const needsEncoding =
        (byte < 32 && !isWhitespace) ||
        byte > 126 ||
        byte === 61 ||
        (isWhitespace && nextIsLineBreak);

      if (needsEncoding) {
        encoded = `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      } else {
        encoded = String.fromCharCode(byte);
      }
    }

    if (currentLineLength + encoded.length > lineLength - 3) {
      result += '=\r\n';
      currentLineLength = 0;
    }

    result += encoded;
    currentLineLength += encoded.length;
    i++;
  }

  return result;
}

/**
 * MCP stdio JSON-RPC framing.
 *
 * Protocol decision:
 * - Prefer official MCP Content-Length framed messages (LSP-style headers).
 * - Also accept newline-delimited JSON (one JSON object per line) for hosts
 *   and tests that speak NDJSON over stdio.
 * - Outbound responses use Content-Length framing by default; when the peer's
 *   first request arrives as NDJSON, subsequent responses also use NDJSON so
 *   hosts that only read lines keep working.
 */

import { Buffer } from 'node:buffer';

export class StdioJsonRpcFramer {
  constructor(opts = {}) {
    this.buffer = Buffer.alloc(0);
    this.mode = opts.mode || 'auto'; // auto | content-length | ndjson
    this.onMessage = opts.onMessage || (() => {});
  }

  push(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, buf]);
    this.#drain();
  }

  #drain() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.mode === 'ndjson') {
        if (!this.#tryReadNdjson()) return;
        continue;
      }
      if (this.mode === 'content-length') {
        if (!this.#tryReadContentLength()) return;
        continue;
      }
      // auto: detect
      if (this.buffer.length === 0) return;
      // Skip leading whitespace/newlines
      let i = 0;
      while (i < this.buffer.length && (this.buffer[i] === 0x20 || this.buffer[i] === 0x09 || this.buffer[i] === 0x0d || this.buffer[i] === 0x0a)) {
        i += 1;
      }
      if (i > 0) this.buffer = this.buffer.subarray(i);
      if (this.buffer.length === 0) return;

      const head = this.buffer.subarray(0, Math.min(64, this.buffer.length)).toString('utf8');
      if (/^Content-Length\s*:/i.test(head)) {
        this.mode = 'content-length';
        if (!this.#tryReadContentLength()) return;
        continue;
      }
      if (this.buffer[0] === 0x7b /* { */) {
        // Could be NDJSON. Prefer NDJSON when a full line is available without Content-Length.
        const nl = this.buffer.indexOf(0x0a);
        if (nl === -1) {
          // Wait for more unless we can parse a complete object without newline (rare).
          // Try content-length first only if headers present; otherwise wait for newline.
          return;
        }
        this.mode = 'ndjson';
        if (!this.#tryReadNdjson()) return;
        continue;
      }
      // Unknown leading bytes — drop one byte to resync safely.
      this.buffer = this.buffer.subarray(1);
    }
  }

  #tryReadContentLength() {
    const text = this.buffer.toString('utf8');
    const headerEnd = text.indexOf('\r\n\r\n');
    const headerEndAlt = text.indexOf('\n\n');
    let sep = headerEnd;
    let sepLen = 4;
    if (sep === -1) {
      sep = headerEndAlt;
      sepLen = 2;
    }
    if (sep === -1) return false;

    const header = text.slice(0, sep);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      // Malformed headers: drop up to separator and continue.
      this.buffer = this.buffer.subarray(Buffer.byteLength(text.slice(0, sep + sepLen), 'utf8'));
      return true;
    }
    const length = Number(match[1]);
    const headerBytes = Buffer.byteLength(text.slice(0, sep + sepLen), 'utf8');
    if (this.buffer.length < headerBytes + length) return false;
    const body = this.buffer.subarray(headerBytes, headerBytes + length).toString('utf8');
    this.buffer = this.buffer.subarray(headerBytes + length);
    this.#emit(body);
    return true;
  }

  #tryReadNdjson() {
    const nl = this.buffer.indexOf(0x0a);
    if (nl === -1) return false;
    let line = this.buffer.subarray(0, nl).toString('utf8');
    this.buffer = this.buffer.subarray(nl + 1);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    line = line.trim();
    if (!line) return true;
    this.#emit(line);
    return true;
  }

  #emit(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (error) {
      this.onMessage({ parseError: true, error, raw });
      return;
    }
    this.onMessage({ parseError: false, message: msg });
  }
}

export function encodeContentLength(message) {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
  return header + body;
}

export function encodeNdjson(message) {
  return `${JSON.stringify(message)}\n`;
}

export function encodeMessage(message, mode = 'content-length') {
  return mode === 'ndjson' ? encodeNdjson(message) : encodeContentLength(message);
}

/**
 * Shared stdio MCP bridge core for Lore channel plugins (zcode, dsh).
 *
 * A plugin ships a thin entry that calls `runLoreMcpBridge({ clientType,
 * transformSkillGetResponse })`. The bridge reads newline- or Content-Length
 * framed MCP JSON-RPC from stdin, forwards every request to
 * `<server>/api/mcp?client_type=<clientType>`, and writes responses back to
 * stdout. Skill tools stay hidden unless the configured server advertises
 * Skills; a successful `lore_skill_get` response is rewritten by the
 * channel-supplied transform so the skill materializes under the Lore home
 * like the other channels.
 *
 * Fail-open: transport and server errors become JSON-RPC error responses, so
 * the host runtime keeps working when Lore is unreachable.
 */

import { loadLoreConfig } from '../lore-config.mjs';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

const SKILL_TOOL_PREFIX = 'lore_skill_';

function isSkillToolCall(message) {
  return message.method === 'tools/call' && String(message.params?.name || '').startsWith(SKILL_TOOL_PREFIX);
}

// Fail-closed: Skill tools stay hidden unless the configured server advertises Skills.
function hideSkillTools(message, payload) {
  if (message.method !== 'tools/list' || !Array.isArray(payload?.result?.tools)) return payload;
  const tools = payload.result.tools.filter((tool) => !String(tool?.name || '').startsWith(SKILL_TOOL_PREFIX));
  return { ...payload, result: { ...payload.result, tools } };
}

export function runLoreMcpBridge(options = {}) {
  const clientType = typeof options.clientType === 'string' && options.clientType.trim()
    ? options.clientType.trim()
    : 'mcp';
  const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
    ? options.requestTimeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS;
  const transformSkillGetResponse = typeof options.transformSkillGetResponse === 'function'
    ? options.transformSkillGetResponse
    : null;

  async function forward(message) {
    const config = loadLoreConfig();
    if (!config.skillsEnabled && isSkillToolCall(message)) {
      return {
        jsonrpc: '2.0',
        id: message.id ?? null,
        result: {
          content: [{ type: 'text', text: 'Connected Lore server does not advertise Skills support.' }],
          isError: true,
        },
      };
    }
    const url = `${config.baseUrl}/api/mcp?client_type=${encodeURIComponent(clientType)}`;
    const headers = { 'content-type': 'application/json' };
    if (config.apiToken) headers.authorization = `Bearer ${config.apiToken}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Lore MCP returned invalid JSON (${response.status})`);
    }
    if (!response.ok) {
      const detail = payload?.detail || payload?.error?.message || payload?.message || `${response.status} ${response.statusText}`;
      throw new Error(String(detail));
    }
    if (!config.skillsEnabled) return hideSkillTools(message, payload);
    if (transformSkillGetResponse) return transformSkillGetResponse(message, payload, config);
    return payload;
  }

  async function handle(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const method = message.method;
    if (typeof method !== 'string') return;
    if (method.startsWith('notifications/')) return;
    if (method === 'exit') {
      process.exit(0);
    }
    try {
      const response = await forward(message);
      writeMessage(response);
    } catch (error) {
      writeMessage(errorResponse(message.id, -32603, error instanceof Error ? error.message : String(error)));
    }
  }

  let buffer = Buffer.alloc(0);
  let draining = Promise.resolve();

  function drain() {
    while (buffer.length > 0) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd >= 0) {
        const headers = buffer.subarray(0, headerEnd).toString('utf8');
        const match = headers.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
        if (!match) {
          buffer = buffer.subarray(headerEnd + 4);
          continue;
        }
        const length = Number(match[1]);
        const start = headerEnd + 4;
        if (buffer.length < start + length) return;
        const body = buffer.subarray(start, start + length).toString('utf8');
        buffer = buffer.subarray(start + length);
        try {
          const message = JSON.parse(body);
          draining = draining.then(() => handle(message));
        } catch {}
        continue;
      }

      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.subarray(0, newline).toString('utf8').trim();
      buffer = buffer.subarray(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        draining = draining.then(() => handle(message));
      } catch {}
    }
  }

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    drain();
  });
}

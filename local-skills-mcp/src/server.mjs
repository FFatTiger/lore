#!/usr/bin/env node
/**
 * Lore local skills MCP server (stdio).
 *
 * Host protocol:
 * - Speaks MCP over stdio with Content-Length framing (default) and NDJSON fallback.
 * - Methods: initialize, notifications/initialized, tools/list, tools/call, ping.
 * - Tool failures return isError content; process stays alive.
 *
 * Env / config (token never required in argv):
 * - LORE_HOME, LORE_BASE_URL, LORE_API_TOKEN (or ~/.lore/config.json)
 * - --client-type codex|claudecode (or LORE_CLIENT_TYPE)
 */

import { loadConfig } from './config.mjs';
import { TOOL_DEFINITIONS, callTool, createToolState, skillsEnabled } from './tools.mjs';
import { StdioJsonRpcFramer, encodeMessage } from './stdio.mjs';

const SERVER_INFO = {
  name: 'lore-skills',
  version: '1.4.1',
};

const PROTOCOL_VERSION = '2024-11-05';

function writeOut(stream, message, mode) {
  stream.write(encodeMessage(message, mode));
}

function makeError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

function makeResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

export function createLocalSkillsMcpServer(opts = {}) {
  const config = opts.config || loadConfig(opts);
  const enabled = skillsEnabled(config);
  const state = createToolState();
  let responseMode = opts.responseMode || 'content-length';
  let initialized = false;
  const stdout = opts.stdout || process.stdout;
  const stderr = opts.stderr || process.stderr;

  const send = (message) => {
    if (message.id === undefined && message.error === undefined && message.result === undefined) {
      // notification
    }
    writeOut(stdout, message, responseMode);
  };

  async function handleMessage(msg) {
    if (!msg || typeof msg !== 'object') {
      send(makeError(null, -32600, 'Invalid Request'));
      return;
    }
    const { id, method, params } = msg;
    if (!method) {
      // response from client — ignore
      return;
    }

    try {
      if (method === 'initialize') {
        initialized = true;
        send(makeResult(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: SERVER_INFO,
          instructions: enabled
            ? 'Local Lore skills MCP. Use lore_skill_list/search/get/create/update/delete/status. Call lore_skill_get with skill_id to fetch a local copy; managed package files are read-only, and the skill directory stays writable for local outputs.'
            : 'Lore Skills are disabled because the connected server does not advertise Skills support.',
        }));
        return;
      }

      if (method === 'notifications/initialized' || method === 'initialized') {
        // notification — no response
        return;
      }

      if (method === 'ping') {
        send(makeResult(id, {}));
        return;
      }

      if (method === 'tools/list') {
        send(makeResult(id, { tools: enabled ? TOOL_DEFINITIONS : [] }));
        return;
      }

      if (method === 'tools/call') {
        const name = String(params?.name || '');
        const args = params?.arguments && typeof params.arguments === 'object'
          ? params.arguments
          : {};
        if (!name) {
          send(makeResult(id, {
            content: [{ type: 'text', text: 'tools/call requires name' }],
            isError: true,
          }));
          return;
        }
        const result = await callTool(config, name, args, state);
        send(makeResult(id, result));
        return;
      }

      // Unknown method
      if (id === undefined || id === null) return; // notification
      send(makeError(id, -32601, `Method not found: ${method}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (id === undefined || id === null) {
        stderr.write(`[lore-skills-mcp] ${message}\n`);
        return;
      }
      // Prefer tool-style soft failure for tools/call; JSON-RPC error for protocol issues.
      send(makeError(id, -32000, message));
    }
  }

  const framer = new StdioJsonRpcFramer({
    mode: opts.frameMode || 'auto',
    onMessage: ({ parseError, message, error, raw }) => {
      if (parseError) {
        send(makeError(null, -32700, 'Parse error', { detail: String(error?.message || raw || '') }));
        return;
      }
      // Mirror peer framing for responses once detected.
      if (framer.mode === 'ndjson') responseMode = 'ndjson';
      if (framer.mode === 'content-length') responseMode = 'content-length';
      void handleMessage(message);
    },
  });

  return {
    config,
    state,
    framer,
    handleMessage,
    push: (chunk) => framer.push(chunk),
    get responseMode() {
      return responseMode;
    },
    get initialized() {
      return initialized;
    },
  };
}

export function startStdioServer(opts = {}) {
  const server = createLocalSkillsMcpServer(opts);
  const stdin = opts.stdin || process.stdin;
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk) => server.push(chunk));
  stdin.on('end', () => {
    // exit cleanly when host closes stdin
    if (!opts.keepAlive) process.exit(0);
  });
  stdin.resume?.();
  return server;
}

// CLI entry
const isMain = process.argv[1]
  && (process.argv[1].endsWith('server.mjs') || process.argv[1].endsWith('lore-skills-mcp'));

if (isMain) {
  try {
    startStdioServer();
  } catch (error) {
    process.stderr.write(`[lore-skills-mcp] fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

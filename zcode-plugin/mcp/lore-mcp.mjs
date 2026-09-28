#!/usr/bin/env node

import { loadLoreConfig } from '../shared/lore-config.mjs';
import { materializeSkill } from './skill-materializer.mjs';

const REQUEST_TIMEOUT_MS = 30_000;

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function transformSkillGetResponse(message, payload, config) {
  if (message.method !== 'tools/call' || message.params?.name !== 'lore_skill_get') return payload;
  if (!payload || typeof payload !== 'object' || payload.error || payload.result?.isError === true) return payload;
  const content = payload.result?.content;
  if (!Array.isArray(content)) return payload;
  const textItem = content.find((item) => item?.type === 'text' && typeof item.text === 'string');
  if (!textItem) return payload;
  let skill;
  try {
    skill = JSON.parse(textItem.text);
  } catch {
    throw new Error('Lore skill get returned invalid package JSON');
  }
  const materialized = materializeSkill(skill, { loreHome: config.loreHome });
  return {
    ...payload,
    result: {
      ...payload.result,
      content: [{ type: 'text', text: JSON.stringify(materialized, null, 2) }],
    },
  };
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
  const url = `${config.baseUrl}/api/mcp?client_type=zcode`;
  const headers = { 'content-type': 'application/json' };
  if (config.apiToken) headers.authorization = `Bearer ${config.apiToken}`;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
  return transformSkillGetResponse(message, payload, config);
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

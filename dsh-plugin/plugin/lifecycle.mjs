/**
 * Lore lifecycle plugin for DeepSeek Harness (dsh).
 *
 * A native Cordis plugin, plain ESM with Node built-ins only.
 *
 * - `agent/created` (serial, all sources) POSTs a `session.start` lifecycle
 *   event to Lore and registers the returned boot context as a per-session
 *   system-prompt section through `agent.ctx.systemPrompt.section()`, so it
 *   reaches only that session's prompt.
 * - `agent/pre-step` (waterfall) fires `prompt.submit` once per new user
 *   message (the first step of a turn whose claimed batch ends with a
 *   user-authored message), then appends the returned recall context to that
 *   step's admitted messages — the same seam the harness runtime context
 *   uses, attributed to a `lore` producer so it is never shown as user input.
 *
 * Fail-open: Lore/network/registration errors are swallowed (optionally
 * logged to stderr with LORE_DEBUG=1) and never propagate into dsh.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLoreConfig, pickString } from '../vendor/lore-config.mjs';

export const name = 'lore-lifecycle';
export const inject = ['workingDirectory'];

const RUNTIME_ID = 'dsh';
// Resolved per call so deployments (and tests) can tighten the budgets.
const sessionStartTimeoutMs = () => positiveIntEnv('LORE_START_TIMEOUT_MS') ?? 8_000;
const promptSubmitTimeoutMs = () => positiveIntEnv('LORE_PROMPT_TIMEOUT_MS') ?? 10_000;
const MAX_TRACKED_SESSIONS = 256;
// After deliverables (9000), before structured output (9900).
const SECTION_ORDER = 9500;
const SECTION_NAME = 'lore:boot';
const DEBUG = pickString(process.env.LORE_DEBUG) === '1';

function debug(message) {
  if (DEBUG) process.stderr.write(`[lore] ${message}\n`);
}

function positiveIntEnv(name) {
  const value = Number.parseInt(pickString(process.env[name]), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function pluginVersion() {
  const manifestPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '.dsh-plugin',
    'plugin.json',
  );
  try {
    return pickString(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))?.version);
  } catch {
    return '';
  }
}

function lifecycleRuntime() {
  const runtime = { runtime_id: RUNTIME_ID, runtime_family: RUNTIME_ID };
  const version = pluginVersion();
  if (version) runtime.plugin_version = version;
  return runtime;
}

// Lore renders the Skills catalog and `$skill-name` invocations only for
// clients that expose Skills tools.
function skillsFeature() {
  return loadLoreConfig().skillsEnabled ? { features: { skills: true } } : {};
}

function detectProjectInfo(cwd) {
  const root = pickString(cwd) || process.cwd();
  const dirName = path.basename(root);
  let repoName = null;
  try {
    const remote = execFileSync('git', ['remote'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')[0];
    if (remote) {
      const remoteUrl = execFileSync('git', ['remote', 'get-url', remote], {
        cwd: root,
        encoding: 'utf-8',
        timeout: 2000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const match = remoteUrl.match(/\/([^/.]+?)(?:\.git)?$/);
      if (match?.[1]) repoName = match[1];
    }
  } catch {}
  return { dir_name: dirName, repo_name: repoName };
}

async function postLifecycle(body, timeoutMs) {
  const config = loadLoreConfig();
  const headers = { 'content-type': 'application/json' };
  if (config.apiToken) headers.authorization = `Bearer ${config.apiToken}`;
  const response = await fetch(`${config.baseUrl}/api/lifecycle/event`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    debug(`lifecycle ${body.event?.name} HTTP ${response.status}`);
    return null;
  }
  return response.json();
}

function hostContext(response, key) {
  const output = response?.host_output;
  if (!output || output.mode !== 'return_value' || !output.value || typeof output.value !== 'object') return '';
  const value = output.value[key];
  return typeof value === 'string' && value.trim() ? value : '';
}

function sessionText(messages) {
  const texts = [];
  for (const message of messages) {
    if (!message || message.source?.kind !== 'user') continue;
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        texts.push(block.text.trim());
      }
    }
  }
  return texts.join('\n\n');
}

function isUserTurnOpening(payload) {
  if (payload.step !== 1 || !Array.isArray(payload.messages) || payload.messages.length === 0) return false;
  const last = payload.messages[payload.messages.length - 1];
  return Boolean(last && last.source?.kind === 'user' && sessionText([last]));
}

function contextMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    // A producer-declared source: `kind` says who produced this (lore), `form`
    // says what it is (material recalled from the memory store), so consumers
    // never present it as something the user typed.
    source: { kind: 'lore', form: 'recall' },
  };
}

export function apply(ctx) {
  const sessions = new Map();

  function stateFor(sessionId) {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    if (sessions.size >= MAX_TRACKED_SESSIONS) {
      sessions.delete(sessions.keys().next().value);
    }
    const state = { systemContext: '', lastPromptMessageId: '' };
    sessions.set(sessionId, state);
    return state;
  }

  function registerBootSection(agent, text) {
    try {
      agent.ctx?.systemPrompt?.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text,
        interpolate: false,
      });
      return true;
    } catch (error) {
      debug(`system prompt section registration failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  ctx.on('agent/created', async ({ agent, source }) => {
    const sessionId = pickString(agent?.id);
    if (!sessionId) return;
    const state = stateFor(sessionId);
    if (source === 'clear') state.systemContext = '';

    if (state.systemContext) {
      registerBootSection(agent, state.systemContext);
      return;
    }

    const cwd = pickString(ctx.workingDirectory?.get?.(agent.session)) || process.cwd();
    try {
      const response = await postLifecycle({
        protocol_version: 'lore.lifecycle.v1',
        runtime: lifecycleRuntime(),
        event: { name: 'session.start', native_name: 'agent/created' },
        ...skillsFeature(),
        normalized: { session_id: sessionId },
        project: detectProjectInfo(cwd),
        native_input_snapshot: { source: pickString(source), cwd },
      }, sessionStartTimeoutMs());
      const systemContext = hostContext(response, 'systemContext');
      if (systemContext) {
        state.systemContext = systemContext;
        registerBootSection(agent, systemContext);
      }
    } catch (error) {
      debug(`session.start failed open: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  ctx.on('agent/pre-step', async (payload, next) => {
    const fire = isUserTurnOpening(payload);
    let recallContext = '';
    if (fire) {
      const sessionId = pickString(payload.agent?.id);
      const lastMessage = payload.messages[payload.messages.length - 1];
      const state = sessionId ? stateFor(sessionId) : null;
      if (state && state.lastPromptMessageId !== lastMessage.id) {
        state.lastPromptMessageId = lastMessage.id;
        try {
          const response = await postLifecycle({
            protocol_version: 'lore.lifecycle.v1',
            runtime: lifecycleRuntime(),
            event: { name: 'prompt.submit', native_name: 'agent/pre-step' },
            ...skillsFeature(),
            normalized: {
              session_id: sessionId,
              prompt: sessionText(payload.messages),
            },
          }, promptSubmitTimeoutMs());
          recallContext = hostContext(response, 'promptContext');
        } catch (error) {
          debug(`prompt.submit failed open: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const decision = await next();
    if (!recallContext || decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision;
    return { ...decision, messages: [...decision.messages, contextMessage(recallContext)] };
  });
}

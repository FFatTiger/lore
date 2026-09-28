/**
 * ZCode SessionStart / UserPromptSubmit hook: forwards lifecycle events to Lore.
 * Fail open: Lore/network/parse errors exit 0 with empty stdout.
 */

import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadLoreConfig, pickString } from '../shared/lore-config.mjs';

const RUNTIME_FAMILY = 'zcode';
const SESSION_START_TIMEOUT_MS = 8000;
const PROMPT_SUBMIT_TIMEOUT_MS = 10000;
const SNAPSHOT_ALLOWLIST = [
  'session_id',
  'sessionId',
  'conversation_id',
  'source',
  'turn_id',
  'turnId',
  'agent_id',
  'agent_type',
  'cwd',
  'model',
  'permission_mode',
  'transcript_path',
  'hook_event_name',
  'hookEventName',
];

function resolveSessionId(input) {
  return pickString(input.session_id)
    || pickString(input.conversation_id)
    || pickString(input.sessionId);
}

function resolveEventName(input) {
  return pickString(input.hook_event_name) || pickString(input.hookEventName);
}

function buildNativeInputSnapshot(input) {
  const snapshot = {};
  for (const key of SNAPSHOT_ALLOWLIST) {
    const value = pickString(input[key]);
    if (value) snapshot[key] = value;
  }
  return Object.keys(snapshot).length ? snapshot : undefined;
}

function detectProjectInfo(cwd) {
  const root = pickString(cwd) || process.cwd();
  const dir_name = path.basename(root);
  let repo_name = null;
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
      if (match?.[1]) repo_name = match[1];
    }
  } catch {}
  return { dir_name, repo_name };
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function postLifecycle(body, timeoutMs) {
  const cfg = loadLoreConfig();
  const headers = { 'content-type': 'application/json' };
  if (cfg.apiToken) headers.authorization = `Bearer ${cfg.apiToken}`;
  const response = await fetch(`${cfg.baseUrl}/api/lifecycle/event`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  return response.json();
}

function writeHostOutput(response) {
  const output = response?.host_output;
  if (!output || output.mode === 'none' || output.value == null) return;
  if (output.mode === 'stdout_json') process.stdout.write(JSON.stringify(output.value));
  if (output.mode === 'stdout_text') process.stdout.write(String(output.value));
}

// Lore renders the Skills catalog and `$skill-name` invocations only for clients
// that expose Skills tools.
function skillsFeature() {
  return loadLoreConfig().skillsEnabled ? { features: { skills: true } } : {};
}

async function main() {
  let input;
  try {
    const raw = await readStdin();
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return;
  }

  const eventName = resolveEventName(input);
  const sessionId = resolveSessionId(input);
  const nativeInputSnapshot = buildNativeInputSnapshot(input);

  if (eventName === 'UserPromptSubmit') {
    const prompt = pickString(input.prompt);
    if (!prompt) return;
    const normalized = { prompt };
    if (sessionId) normalized.session_id = sessionId;
    const lifecycle = await postLifecycle({
      protocol_version: 'lore.lifecycle.v1',
      runtime: { runtime_id: RUNTIME_FAMILY, runtime_family: RUNTIME_FAMILY },
      event: { name: 'prompt.submit', native_name: 'UserPromptSubmit' },
      ...skillsFeature(),
      normalized,
      ...(nativeInputSnapshot ? { native_input_snapshot: nativeInputSnapshot } : {}),
    }, PROMPT_SUBMIT_TIMEOUT_MS);
    writeHostOutput(lifecycle);
    return;
  }

  if (eventName && eventName !== 'SessionStart') return;

  const lifecycle = await postLifecycle({
    protocol_version: 'lore.lifecycle.v1',
    runtime: { runtime_id: RUNTIME_FAMILY, runtime_family: RUNTIME_FAMILY },
    event: { name: 'session.start', native_name: 'SessionStart' },
    ...skillsFeature(),
    normalized: sessionId ? { session_id: sessionId } : {},
    project: detectProjectInfo(input.cwd),
    ...(nativeInputSnapshot ? { native_input_snapshot: nativeInputSnapshot } : {}),
  }, SESSION_START_TIMEOUT_MS);
  writeHostOutput(lifecycle);
}

main().catch(() => {}).then(() => {
  process.exit(0);
});

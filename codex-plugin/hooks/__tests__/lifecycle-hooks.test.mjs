import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const hooksDir = path.resolve(import.meta.dirname, '..');
const scriptsDir = path.resolve(import.meta.dirname, '../../scripts');
const recallHook = path.join(hooksDir, 'recall-inject.mjs');
const rulesHook = path.join(hooksDir, 'rules-inject.mjs');
const installHooksScript = path.join(scriptsDir, 'install-hooks.sh');
const isolatedHome = mkdtempSync(path.join(tmpdir(), 'lore-codex-hook-home-'));

function runHook(scriptPath, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: hooksDir,
      env: {
        ...process.env,
        HOME: isolatedHome,
        LORE_API_TOKEN: '',
        API_TOKEN: '',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

async function withServer(onRequest) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push(body);
    const response = onRequest?.(body) ?? { host_output: { mode: 'none' } };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test.after(() => {
  rmSync(isolatedHome, { recursive: true, force: true });
});

test('UserPromptSubmit omits invented codex session_id but still posts prompt.submit', async () => {
  const server = await withServer(() => ({
    host_output: { mode: 'stdout_text', value: 'CODEX_RECALL' },
  }));

  try {
    const result = await runHook(recallHook, {
      prompt: 'anonymous prompt',
      hook_event_name: 'UserPromptSubmit',
      turn_id: 'turn-1',
      agent_id: 'agent-1',
      agent_type: 'worker',
      cwd: '/tmp/codex-project',
      model: 'gpt-test',
      permission_mode: 'ask',
      transcript_path: '/tmp/codex-transcript.jsonl',
      source: 'user',
      secret: 'nope',
    }, {
      LORE_CODEX_HOOK_BASE_URL: server.baseUrl,
      LORE_BASE_URL: server.baseUrl,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, 'CODEX_RECALL');
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].event.name, 'prompt.submit');
    assert.equal(server.requests[0].normalized.prompt, 'anonymous prompt');
    assert.equal(Object.hasOwn(server.requests[0].normalized, 'session_id'), false);
    assert.notEqual(server.requests[0].normalized.session_id, 'codex');
    assert.equal(Object.hasOwn(server.requests[0].normalized, 'turn_id'), false);
    assert.deepEqual(server.requests[0].native_input_snapshot, {
      source: 'user',
      turn_id: 'turn-1',
      agent_id: 'agent-1',
      agent_type: 'worker',
      cwd: '/tmp/codex-project',
      model: 'gpt-test',
      permission_mode: 'ask',
      transcript_path: '/tmp/codex-transcript.jsonl',
    });
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'prompt'), false);
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'user_prompt'), false);
  } finally {
    await server.close();
  }
});

test('UserPromptSubmit resolves session_id then conversation_id', async () => {
  const server = await withServer();
  try {
    await runHook(recallHook, {
      session_id: 's-primary',
      conversation_id: 'c-secondary',
      prompt: 'with ids',
      turn_id: 't2',
    }, {
      LORE_CODEX_HOOK_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests[0].normalized.session_id, 's-primary');
    assert.equal(server.requests[0].native_input_snapshot.session_id, 's-primary');
    assert.equal(server.requests[0].native_input_snapshot.conversation_id, 'c-secondary');
    assert.equal(server.requests[0].native_input_snapshot.turn_id, 't2');

    await runHook(recallHook, {
      conversation_id: 'c-only',
      prompt: 'conversation only',
    }, {
      LORE_CODEX_HOOK_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests[1].normalized.session_id, 'c-only');
  } finally {
    await server.close();
  }
});

test('SessionStart preserves source and omits missing session_id', async () => {
  const server = await withServer(() => ({
    host_output: {
      mode: 'stdout_json',
      value: {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'CODEX_BOOT',
        },
      },
    },
  }));

  try {
    const result = await runHook(rulesHook, {
      hook_event_name: 'SessionStart',
      source: 'resume',
      cwd: '/tmp/codex-boot',
      model: 'gpt-test',
      permission_mode: 'allow',
      transcript_path: '/tmp/session.jsonl',
      turn_id: 'boot-turn',
    }, {
      LORE_CODEX_HOOK_BASE_URL: server.baseUrl,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /CODEX_BOOT/);
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].event.name, 'session.start');
    assert.deepEqual(server.requests[0].normalized, {});
    assert.equal(server.requests[0].native_input_snapshot.source, 'resume');
    assert.equal(server.requests[0].native_input_snapshot.cwd, '/tmp/codex-boot');
    assert.equal(server.requests[0].native_input_snapshot.model, 'gpt-test');
    assert.equal(server.requests[0].native_input_snapshot.turn_id, 'boot-turn');
  } finally {
    await server.close();
  }
});

test('legacy install-hooks.sh SessionStart matcher matches bundled startup|resume|clear', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lore-codex-legacy-hooks-'));
  const codexHome = path.join(root, 'codex-home');
  mkdirSync(codexHome, { recursive: true });

  try {
    execFileSync('bash', [installHooksScript], {
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
      },
      stdio: 'pipe',
    });
    const hooks = JSON.parse(readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'));
    assert.equal(hooks.hooks.SessionStart[0].matcher, 'startup|resume|clear');
    assert.equal(hooks.hooks.UserPromptSubmit[0].matcher, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bundled hooks.json keeps portable commands and SessionStart matcher', () => {
  const hooks = JSON.parse(readFileSync(path.join(hooksDir, 'hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.SessionStart[0].matcher, 'startup|resume|clear');
  const commands = Object.values(hooks.hooks)
    .flatMap((entries) => entries)
    .flatMap((entry) => entry.hooks)
    .map((hook) => hook.command);
  assert.ok(commands.every((command) => command.startsWith('node "')));
  assert.ok(commands.every((command) => !command.includes('LORE_BASE_URL=')));
});

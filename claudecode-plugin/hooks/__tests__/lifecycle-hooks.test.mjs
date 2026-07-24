import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const hooksDir = path.resolve(import.meta.dirname, '..');
const recallHook = path.join(hooksDir, 'recall-inject.ts');
const rulesHook = path.join(hooksDir, 'rules-inject.ts');
const isolatedHome = mkdtempSync(path.join(tmpdir(), 'lore-claude-hook-home-'));

function runHook(scriptPath, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', scriptPath], {
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

test('UserPromptSubmit prefers official prompt over user_prompt and omits invented session_id', async () => {
  const server = await withServer(() => ({
    host_output: { mode: 'stdout_text', value: 'RECALL_BLOCK' },
  }));

  try {
    const result = await runHook(recallHook, {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'official prompt text',
      user_prompt: 'legacy alias should lose',
      cwd: '/tmp/project',
      permission_mode: 'ask',
      transcript_path: '/tmp/transcript.txt',
      source: 'user',
      secret_token: 'do-not-forward',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, 'RECALL_BLOCK');
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].event.name, 'prompt.submit');
    assert.equal(server.requests[0].normalized.prompt, 'official prompt text');
    assert.equal(Object.hasOwn(server.requests[0].normalized, 'session_id'), false);
    assert.notEqual(server.requests[0].normalized.session_id, 'claude-code');
    assert.deepEqual(server.requests[0].native_input_snapshot, {
      hook_event_name: 'UserPromptSubmit',
      cwd: '/tmp/project',
      permission_mode: 'ask',
      transcript_path: '/tmp/transcript.txt',
      source: 'user',
    });
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'secret_token'), false);
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'prompt'), false);
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'user_prompt'), false);
  } finally {
    await server.close();
  }
});

test('UserPromptSubmit keeps prompt alias and forwards session_id', async () => {
  const server = await withServer();
  try {
    const result = await runHook(recallHook, {
      session_id: 'sess-1',
      prompt: 'legacy prompt field',
      hook_event_name: 'UserPromptSubmit',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].normalized.session_id, 'sess-1');
    assert.equal(server.requests[0].normalized.prompt, 'legacy prompt field');
    assert.equal(server.requests[0].native_input_snapshot.session_id, 'sess-1');
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'prompt'), false);
  } finally {
    await server.close();
  }
});

test('UserPromptSubmit falls back to user_prompt when prompt is blank', async () => {
  const server = await withServer();
  try {
    await runHook(recallHook, {
      prompt: '   ',
      user_prompt: 'fallback user_prompt text',
      hook_event_name: 'UserPromptSubmit',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].normalized.prompt, 'fallback user_prompt text');
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'prompt'), false);
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'user_prompt'), false);
  } finally {
    await server.close();
  }
});

test('UserPromptSubmit prefers session_id over conversation_id', async () => {
  const server = await withServer();
  try {
    await runHook(recallHook, {
      session_id: 'primary',
      conversation_id: 'secondary',
      user_prompt: 'hello',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests[0].normalized.session_id, 'primary');
    assert.equal(server.requests[0].native_input_snapshot.conversation_id, 'secondary');
  } finally {
    await server.close();
  }
});

test('UserPromptSubmit falls back to conversation_id and skips empty prompt', async () => {
  const server = await withServer();
  try {
    await runHook(recallHook, {
      conversation_id: 'conv-only',
      user_prompt: 'from conversation',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].normalized.session_id, 'conv-only');

    const empty = await runHook(recallHook, {
      session_id: 'sess-2',
      user_prompt: '   ',
      prompt: '',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });
    assert.equal(empty.code, 0, empty.stderr);
    assert.equal(server.requests.length, 1);
  } finally {
    await server.close();
  }
});

test('SessionStart preserves source metadata and omits missing session_id', async () => {
  const server = await withServer(() => ({
    host_output: {
      mode: 'stdout_json',
      value: {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'BOOT',
        },
      },
    },
  }));

  try {
    const result = await runHook(rulesHook, {
      hook_event_name: 'SessionStart',
      source: 'resume',
      cwd: '/tmp/claude-project',
      permission_mode: 'allow',
      transcript_path: '/tmp/t.txt',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /additionalContext":"BOOT"/);
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].event.name, 'session.start');
    assert.deepEqual(server.requests[0].normalized, {});
    assert.equal(server.requests[0].native_input_snapshot.source, 'resume');
    assert.equal(server.requests[0].native_input_snapshot.cwd, '/tmp/claude-project');
    assert.equal(server.requests[0].project.dir_name.length > 0, true);
  } finally {
    await server.close();
  }
});

test('bundled hooks.json uses portable quoted commands', () => {
  const hooks = JSON.parse(readFileSync(path.join(hooksDir, 'hooks.json'), 'utf8'));
  const commands = Object.values(hooks.hooks)
    .flatMap((entries) => entries)
    .flatMap((entry) => entry.hooks)
    .map((hook) => hook.command);
  assert.ok(commands.every((command) => command.startsWith('npx tsx "')));
  assert.ok(commands.every((command) => !command.includes('LORE_BASE_URL=')));
});

test('SessionStart uses conversation_id when session_id is absent', async () => {
  const server = await withServer();
  try {
    await runHook(rulesHook, {
      conversation_id: 'c-9',
      source: 'startup',
      hook_event_name: 'SessionStart',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests[0].normalized.session_id, 'c-9');
    assert.equal(server.requests[0].native_input_snapshot.conversation_id, 'c-9');
    assert.equal(server.requests[0].native_input_snapshot.source, 'startup');
  } finally {
    await server.close();
  }
});

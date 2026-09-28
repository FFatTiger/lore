import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const hooksDir = path.resolve(import.meta.dirname, '..');
const pluginRoot = path.resolve(hooksDir, '..');
const hookScript = path.join(hooksDir, 'lifecycle-hooks.mjs');
const isolatedHome = mkdtempSync(path.join(tmpdir(), 'lore-zcode-hook-home-'));

function runHook(input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScript], {
      cwd: hooksDir,
      env: {
        ...process.env,
        HOME: isolatedHome,
        LORE_HOME: '',
        LORE_SKILLS_ENABLED: '',
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
  const headers = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try {
      body = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      body = { parse_error: true };
    }
    requests.push(body);
    headers.push(req.headers);
    const response = onRequest?.(body) ?? { host_output: { mode: 'none' } };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    headers,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test.after(() => {
  rmSync(isolatedHome, { recursive: true, force: true });
});

test('bundled hooks.json uses process hooks, SessionStart matcher, and exact timeouts', () => {
  const hooks = JSON.parse(readFileSync(path.join(hooksDir, 'hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.SessionStart[0].matcher, 'startup|resume|clear');
  assert.equal(hooks.hooks.SessionStart[0].hooks[0].type, 'process');
  assert.equal(hooks.hooks.SessionStart[0].hooks[0].timeoutMs, 8000);
  assert.equal(hooks.hooks.UserPromptSubmit[0].hooks[0].type, 'process');
  assert.equal(hooks.hooks.UserPromptSubmit[0].hooks[0].timeoutMs, 10000);
  assert.equal(Object.hasOwn(hooks.hooks, 'Stop'), false);
  const commands = Object.values(hooks.hooks)
    .flatMap((entries) => entries)
    .flatMap((entry) => entry.hooks);
  assert.ok(commands.every((hook) => hook.command === 'node'));
  assert.ok(commands.every((hook) => hook.args[0].includes('${ZCODE_PLUGIN_ROOT}/hooks/lifecycle-hooks.mjs')));
});

test('plugin layout declares the official Lore MCP bridge', () => {
  const manifest = JSON.parse(readFileSync(path.join(pluginRoot, '.zcode-plugin', 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(readFileSync(path.join(pluginRoot, 'marketplace.json'), 'utf8'));
  const mcp = JSON.parse(readFileSync(path.join(pluginRoot, '.mcp.json'), 'utf8'));
  const hooksSource = readFileSync(path.join(hooksDir, 'lifecycle-hooks.mjs'), 'utf8');
  assert.equal(manifest.name, 'lore');
  assert.equal(Object.hasOwn(manifest, 'tools'), false);
  assert.equal(mcp.mcpServers.lore.type, 'stdio');
  assert.equal(mcp.mcpServers.lore.command, 'node');
  assert.match(mcp.mcpServers.lore.args[0], /mcp\/lore-mcp\.mjs/);
  assert.equal(marketplace.name, 'lore');
  assert.equal(marketplace.plugins[0].source, './');
  assert.doesNotMatch(hooksSource, /mcp/i);
  assert.match(hooksSource, /execFileSync\('git', \['remote'\]/);
  assert.match(hooksSource, /execFileSync\('git', \['remote', 'get-url', remote\]/);
  assert.doesNotMatch(hooksSource, /execSync\(/);
});

test('UserPromptSubmit omits invented session_id and does not leak prompt into snapshot', async () => {
  const server = await withServer(() => ({
    host_output: {
      mode: 'stdout_json',
      value: {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: 'ZCODE_RECALL',
        },
      },
    },
  }));

  try {
    const result = await runHook({
      prompt: 'anonymous prompt',
      hook_event_name: 'UserPromptSubmit',
      hookEventName: 'UserPromptSubmit',
      turn_id: 'turn-1',
      turnId: 'turn-1',
      agent_id: 'agent-1',
      agent_type: 'worker',
      cwd: '/tmp/zcode-project',
      model: 'glm-test',
      permission_mode: 'ask',
      transcript_path: '/tmp/zcode-transcript.jsonl',
      source: 'user',
      secret: 'nope',
      user_prompt: 'should-not-leak',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });

    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.equal(output.hookSpecificOutput.additionalContext, 'ZCODE_RECALL');
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].runtime.runtime_id, 'zcode');
    assert.equal(server.requests[0].runtime.runtime_family, 'zcode');
    assert.equal(server.requests[0].event.name, 'prompt.submit');
    assert.equal(server.requests[0].event.native_name, 'UserPromptSubmit');
    assert.equal(server.requests[0].normalized.prompt, 'anonymous prompt');
    assert.equal(Object.hasOwn(server.requests[0].normalized, 'session_id'), false);
    assert.notEqual(server.requests[0].normalized.session_id, 'zcode');
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'prompt'), false);
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'user_prompt'), false);
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'secret'), false);
    assert.equal(server.requests[0].native_input_snapshot.cwd, '/tmp/zcode-project');
    assert.equal(server.requests[0].native_input_snapshot.turn_id, 'turn-1');
  } finally {
    await server.close();
  }
});

test('UserPromptSubmit resolves session_id then conversation_id then sessionId', async () => {
  const server = await withServer();
  try {
    await runHook({
      session_id: 's-primary',
      conversation_id: 'c-secondary',
      sessionId: 's-camel',
      prompt: 'with ids',
      hook_event_name: 'UserPromptSubmit',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests[0].normalized.session_id, 's-primary');
    assert.equal(server.requests[0].native_input_snapshot.session_id, 's-primary');
    assert.equal(server.requests[0].native_input_snapshot.conversation_id, 'c-secondary');

    await runHook({
      conversation_id: 'c-only',
      sessionId: 's-camel',
      prompt: 'conversation only',
      hookEventName: 'UserPromptSubmit',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests[1].normalized.session_id, 'c-only');

    await runHook({
      sessionId: 's-camel-only',
      prompt: 'camel only',
      hook_event_name: 'UserPromptSubmit',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests[2].normalized.session_id, 's-camel-only');
  } finally {
    await server.close();
  }
});

test('UserPromptSubmit skips empty prompt without posting', async () => {
  const server = await withServer();
  try {
    const result = await runHook({
      prompt: '   ',
      hook_event_name: 'UserPromptSubmit',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
  }
});

test('SessionStart preserves source, posts project context, and omits missing session_id', async () => {
  const server = await withServer(() => ({
    host_output: {
      mode: 'stdout_json',
      value: {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'ZCODE_BOOT',
        },
      },
    },
  }));

  try {
    const result = await runHook({
      hook_event_name: 'SessionStart',
      source: 'resume',
      cwd: pluginRoot,
      model: 'glm-test',
      permission_mode: 'allow',
      transcript_path: '/tmp/session.jsonl',
      turn_id: 'boot-turn',
    }, {
      LORE_BASE_URL: server.baseUrl,
    });

    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.equal(output.hookSpecificOutput.additionalContext, 'ZCODE_BOOT');
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].runtime.runtime_family, 'zcode');
    assert.equal(server.requests[0].event.name, 'session.start');
    assert.equal(server.requests[0].event.native_name, 'SessionStart');
    assert.deepEqual(server.requests[0].normalized, {});
    assert.equal(server.requests[0].native_input_snapshot.source, 'resume');
    assert.equal(server.requests[0].project.dir_name, 'zcode-plugin');
    assert.equal(Object.hasOwn(server.requests[0].native_input_snapshot, 'prompt'), false);
  } finally {
    await server.close();
  }
});

test('SessionStart reads ~/.lore/config.json before env', async () => {
  const loreDir = path.join(isolatedHome, '.lore');
  mkdirSync(loreDir, { recursive: true });
  const server = await withServer();
  writeFileSync(path.join(loreDir, 'config.json'), JSON.stringify({
    base_url: server.baseUrl,
    api_token: 'cfg-token',
  }));
  try {
    const result = await runHook({
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, {
      LORE_BASE_URL: 'http://127.0.0.1:1',
      LORE_API_TOKEN: 'env-token',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].runtime.runtime_family, 'zcode');
    assert.equal(server.requests[0].event.native_name, 'SessionStart');
    assert.equal(server.headers[0].authorization, 'Bearer cfg-token');
    assert.doesNotMatch(JSON.stringify(server.requests[0]), /cfg-token|env-token/);
  } finally {
    await server.close();
    rmSync(path.join(loreDir, 'config.json'), { force: true });
  }
});

test('hooks fail open on parse errors and unreachable servers', async () => {
  const result = await runHook('{not-json', {
    LORE_BASE_URL: 'http://127.0.0.1:1',
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');

  const network = await runHook({
    hook_event_name: 'UserPromptSubmit',
    prompt: 'hello',
  }, {
    LORE_BASE_URL: 'http://127.0.0.1:1',
  });
  assert.equal(network.code, 0, network.stderr);
  assert.equal(network.stdout, '');
});

test('Skills-enabled hooks declare features.skills and write Lore host output through', async () => {
  const server = await withServer((body) => ({
    host_output: {
      mode: 'stdout_json',
      value: { hookSpecificOutput: { hookEventName: body.event.native_name, additionalContext: `${body.event.name}:skills` } },
    },
  }));
  try {
    const env = { LORE_BASE_URL: server.baseUrl, LORE_SKILLS_ENABLED: '1' };
    const start = await runHook({ hook_event_name: 'SessionStart', session_id: 's1' }, env);
    const prompt = await runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'run $deploy', session_id: 's1' }, env);
    assert.equal(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, 'session.start:skills');
    assert.equal(JSON.parse(prompt.stdout).hookSpecificOutput.additionalContext, 'prompt.submit:skills');
    assert.deepEqual(server.requests.map((body) => body.features), [{ skills: true }, { skills: true }]);
  } finally {
    await server.close();
  }
});

test('Skills stay off unless the configured server advertises them', async () => {
  const server = await withServer();
  const loreHome = mkdtempSync(path.join(tmpdir(), 'lore-zcode-hook-profile-'));
  try {
    writeFileSync(path.join(loreHome, 'config.json'), JSON.stringify({
      base_url: server.baseUrl,
      server_profile: { base_url: `${server.baseUrl}/`, capabilities: { skills: true } },
    }));
    await runHook({ hook_event_name: 'SessionStart', session_id: 's1' }, { LORE_HOME: loreHome });
    await runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }, { LORE_HOME: loreHome, LORE_SKILLS_ENABLED: '0' });
    await runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }, { LORE_BASE_URL: server.baseUrl });
    assert.deepEqual(server.requests.map((body) => body.features), [{ skills: true }, undefined, undefined]);
  } finally {
    rmSync(loreHome, { recursive: true, force: true });
    await server.close();
  }
});

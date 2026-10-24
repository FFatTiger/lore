import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { computeManifestHash, sha256Text } from '../../vendor/skill-workcopy/index.mjs';

const hooksDir = path.resolve(import.meta.dirname, '..');
const pluginRoot = path.resolve(hooksDir, '..');
const hookScript = path.join(hooksDir, 'lifecycle-hooks.mjs');
const pluginVersion = JSON.parse(
  readFileSync(path.join(pluginRoot, '.zcode-plugin', 'plugin.json'), 'utf8'),
).version;
const isolatedHome = mkdtempSync(path.join(tmpdir(), 'lore-zcode-hook-home-'));
// Default isolated plugin root: detached skills-sync children spawned by the
// hook must never write into the repository checkout.
const defaultPluginRoot = mkdtempSync(path.join(tmpdir(), 'lore-zcode-plugin-root-'));

/** Server-side skill package used by the native-sync tests. */
function syncedSkillFixture() {
  const content = '# Synced Skill\n\nDo it natively.\n';
  const sha256 = sha256Text(content);
  const files = [{ path: 'SKILL.md', content, sha256, size: Buffer.byteLength(content, 'utf-8') }];
  const manifest_hash = computeManifestHash([{ path: 'SKILL.md', sha256, size: files[0].size }]);
  return {
    detail: {
      skill_id: 'sk-sync-1',
      name: 'synced-skill',
      version: 3,
      manifest_hash,
      files,
    },
    summary: { skill_id: 'sk-sync-1', name: 'synced-skill', version: 3, manifest_hash },
  };
}

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
        ZCODE_PLUGIN_ROOT: defaultPluginRoot,
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

async function withServer(onRequest, skillsRoutes) {
  const requests = [];
  const headers = [];
  const skillRequests = [];
  const routes = skillsRoutes || {};
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/api/skills') {
        skillRequests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
        const list = routes.list || (() => ({ project_id: 'proj-1', catalog_revision: '0', skills: [] }));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(await list()));
        return;
      }
      const detailMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
      if (detailMatch) {
        skillRequests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
        const detail = routes.detail || (() => null);
        const data = await detail(decodeURIComponent(detailMatch[1]));
        if (data) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(data));
        } else {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ detail: 'not found' }));
        }
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'not found' }));
      return;
    }
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
    skillRequests,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test.after(() => {
  rmSync(isolatedHome, { recursive: true, force: true });
  rmSync(defaultPluginRoot, { recursive: true, force: true });
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for the detached skills-sync child to record its outcome. */
async function waitForStatusFile(pluginRootDir, timeoutMs = 30000) {
  const statusPath = path.join(pluginRootDir, 'skills', '.lore-sync-status.json');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(statusPath)) return JSON.parse(readFileSync(statusPath, 'utf8'));
    await delay(100);
  }
  throw new Error(`skills sync status file not written: ${statusPath}`);
}

/** Isolated plugin root with the vendored sync script the hook spawns. */
function makeSyncCapablePluginRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'lore-zcode-sync-root-'));
  cpSync(
    path.join(pluginRoot, 'vendor', 'skill-workcopy'),
    path.join(root, 'vendor', 'skill-workcopy'),
    { recursive: true },
  );
  return root;
}

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
  assert.equal(manifest.skills, './skills');
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

test('Skills-enabled hooks write Lore host output through and never declare skills features', async () => {
  const server = await withServer((body) => ({
    host_output: {
      mode: 'stdout_json',
      value: { hookSpecificOutput: { hookEventName: body.event.native_name, additionalContext: `${body.event.name}:through` } },
    },
  }));
  try {
    const env = { LORE_BASE_URL: server.baseUrl, LORE_SKILLS_ENABLED: '1' };
    const start = await runHook({ hook_event_name: 'SessionStart', session_id: 's1' }, env);
    const prompt = await runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'hello', session_id: 's1' }, env);
    assert.equal(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, 'session.start:through');
    assert.equal(JSON.parse(prompt.stdout).hookSpecificOutput.additionalContext, 'prompt.submit:through');
    assert.deepEqual(server.requests.map((body) => body.features), [undefined, undefined]);
  } finally {
    await server.close();
  }
});

test('SessionStart spawns a detached skills sync and exits before it finishes', async () => {
  const fixture = syncedSkillFixture();
  let releaseCatalog;
  const catalogGate = new Promise((resolve) => { releaseCatalog = resolve; });
  const server = await withServer(() => ({
    host_output: { mode: 'stdout_text', value: 'BOOT_OK' },
  }), {
    list: async () => {
      await catalogGate;
      return { project_id: 'proj-1', catalog_revision: 'rev-5', skills: [fixture.summary] };
    },
    detail: (id) => (id === fixture.detail.skill_id ? fixture.detail : null),
  });
  const syncRoot = makeSyncCapablePluginRoot();
  try {
    const started = Date.now();
    const result = await runHook({ hook_event_name: 'SessionStart', session_id: 's-sync' }, {
      LORE_BASE_URL: server.baseUrl,
      LORE_SKILLS_ENABLED: '1',
      ZCODE_PLUGIN_ROOT: syncRoot,
    });
    const hookMs = Date.now() - started;
    // The hook wrote its full lifecycle output and exited without waiting for
    // the gated background sync.
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, 'BOOT_OK');
    assert.ok(hookMs < 2500, `hook waited for the skills sync (${hookMs}ms)`);

    releaseCatalog();
    const status = await waitForStatusFile(syncRoot);
    assert.deepEqual(status.created, ['synced-skill']);
    assert.deepEqual(status.errors, []);
    assert.equal(
      readFileSync(path.join(syncRoot, 'skills', 'synced-skill', 'SKILL.md'), 'utf-8'),
      '# Synced Skill\n\nDo it natively.\n',
    );
    assert.equal(server.skillRequests[0].query.client_type, 'zcode');
    assert.equal(server.requests[0].features, undefined);
  } finally {
    releaseCatalog();
    rmSync(syncRoot, { recursive: true, force: true });
    await server.close();
  }
});

test('skills sync only spawns for a configured server profile or an explicit env flag', async () => {
  const server = await withServer();
  const loreHome = mkdtempSync(path.join(tmpdir(), 'lore-zcode-hook-profile-'));
  try {
    // No profile and no env flag: nothing is spawned and features stay off.
    await runHook({ hook_event_name: 'SessionStart', session_id: 's1' }, { LORE_BASE_URL: server.baseUrl });
    await delay(300);
    assert.equal(existsSync(path.join(defaultPluginRoot, 'skills')), false);
    assert.deepEqual(server.requests.map((body) => body.features), [undefined]);

    // A matching server_profile with capabilities.skills turns the sync on.
    const syncRoot = makeSyncCapablePluginRoot();
    writeFileSync(path.join(loreHome, 'config.json'), JSON.stringify({
      base_url: server.baseUrl,
      server_profile: { base_url: `${server.baseUrl}/`, capabilities: { skills: true } },
    }));
    try {
      await runHook({ hook_event_name: 'SessionStart', session_id: 's1' }, { LORE_HOME: loreHome, ZCODE_PLUGIN_ROOT: syncRoot });
      const status = await waitForStatusFile(syncRoot);
      assert.deepEqual(status.created, []);
      assert.deepEqual(status.errors, []);
      assert.equal(server.requests[1].features, undefined);
    } finally {
      rmSync(syncRoot, { recursive: true, force: true });
    }

    // LORE_SKILLS_ENABLED=0 keeps the sync off even with a matching profile.
    const offRoot = makeSyncCapablePluginRoot();
    try {
      await runHook({ hook_event_name: 'SessionStart', session_id: 's1' }, {
        LORE_HOME: loreHome,
        LORE_SKILLS_ENABLED: '0',
        ZCODE_PLUGIN_ROOT: offRoot,
      });
      await delay(300);
      assert.equal(existsSync(path.join(offRoot, 'skills')), false);
    } finally {
      rmSync(offRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(loreHome, { recursive: true, force: true });
    await server.close();
  }
});

test('lifecycle runtime reports the plugin manifest version', async () => {
  const server = await withServer();
  try {
    await runHook({ hook_event_name: 'SessionStart', session_id: 's1' }, {
      LORE_BASE_URL: server.baseUrl,
    });
    await runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'hello', session_id: 's1' }, {
      LORE_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests.length, 2);
    for (const body of server.requests) {
      assert.equal(body.runtime.runtime_id, 'zcode');
      assert.equal(body.runtime.runtime_family, 'zcode');
      assert.equal(body.runtime.plugin_version, pluginVersion);
    }
  } finally {
    await server.close();
  }
});

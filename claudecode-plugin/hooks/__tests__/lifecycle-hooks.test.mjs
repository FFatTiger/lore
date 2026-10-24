import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { computeManifestHash, sha256Text } from '../vendor/skill-workcopy/index.mjs';

const hooksDir = path.resolve(import.meta.dirname, '..');
const recallHook = path.join(hooksDir, 'recall-inject.ts');
const rulesHook = path.join(hooksDir, 'rules-inject.ts');
const pluginVersion = JSON.parse(
  readFileSync(path.join(hooksDir, '..', '.claude-plugin', 'plugin.json'), 'utf8'),
).version;
const isolatedHome = mkdtempSync(path.join(tmpdir(), 'lore-claude-hook-home-'));
// Default isolated plugin root: detached skills-sync children spawned by the
// hook must never write into the repository checkout.
const defaultPluginRoot = mkdtempSync(path.join(tmpdir(), 'lore-claude-plugin-home-'));
const skillsSyncScript = path.join(hooksDir, 'vendor', 'skill-workcopy', 'skills-sync.mjs');

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

function runHook(scriptPath, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', scriptPath], {
      cwd: hooksDir,
      env: {
        ...process.env,
        HOME: isolatedHome,
        LORE_HOME: isolatedHome,
        LORE_API_TOKEN: '',
        API_TOKEN: '',
        CLAUDE_PLUGIN_ROOT: defaultPluginRoot,
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
  const skillRequests = [];
  const routes = skillsRoutes || {};
  const server = createServer(async (req, res) => {
    const respond = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(data === undefined ? '' : JSON.stringify(data));
    };
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/api/skills') {
        skillRequests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
        const list = routes.list || (() => ({ project_id: 'proj-1', catalog_revision: '0', skills: [] }));
        return respond(200, await list());
      }
      const detailMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
      if (detailMatch) {
        skillRequests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
        const detail = routes.detail || (() => null);
        const data = await detail(decodeURIComponent(detailMatch[1]));
        if (data) return respond(200, data);
        return respond(404, { detail: 'not found' });
      }
      return respond(404, { detail: 'not found' });
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push(body);
    const response = onRequest?.(body) ?? { host_output: { mode: 'none' } };
    respond(200, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
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
async function waitForStatusFile(pluginRoot, timeoutMs = 30000) {
  const statusPath = path.join(pluginRoot, 'skills', '.lore-sync-status.json');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(statusPath)) return JSON.parse(readFileSync(statusPath, 'utf8'));
    await delay(100);
  }
  throw new Error(`skills sync status file not written: ${statusPath}`);
}

/** Run the standalone shared sync script directly and resolve its exit code. */
function runSyncScript(pluginRoot, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [skillsSyncScript, '--client-type', 'claudecode', '--root', path.join(pluginRoot, 'skills')], {
      env: {
        ...process.env,
        HOME: isolatedHome,
        LORE_HOME: isolatedHome,
        LORE_API_TOKEN: '',
        API_TOKEN: '',
        ...env,
      },
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
}

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


test('Skills-enabled hooks write host output through without advertising features.skills', async () => {
  const server = await withServer((body) => ({
    host_output: {
      mode: 'stdout_text',
      value: body.event.name === 'session.start' ? 'BOOT_CONTEXT' : 'RECALL_BLOCK',
    },
  }));
  try {
    const env = { LORE_BASE_URL: server.baseUrl, LORE_SKILLS_ENABLED: '1' };
    const start = await runHook(rulesHook, { session_id: 's1', hook_event_name: 'SessionStart' }, env);
    const prompt = await runHook(recallHook, { prompt: 'run $deploy', session_id: 's1' }, env);
    assert.equal(start.stdout, 'BOOT_CONTEXT');
    assert.equal(prompt.stdout, 'RECALL_BLOCK');
    // Skills are synced into the plugin directory instead of the injected catalog,
    // so the lifecycle requests must not ask for skills features anymore.
    assert.deepEqual(server.requests.map((body) => body.features), [undefined, undefined]);
  } finally {
    await server.close();
  }
});

test('SessionStart spawns a detached skills sync and exits without waiting for it', async () => {
  const fixture = syncedSkillFixture();
  // The list response is slower than any plausible hook runtime; a hook that
  // waited for the sync would blow past this delay.
  const LIST_DELAY_MS = 6000;
  const server = await withServer(() => ({ host_output: { mode: 'stdout_text', value: 'BOOT' } }), {
    list: async () => {
      await delay(LIST_DELAY_MS);
      return { project_id: 'proj-1', catalog_revision: 'rev-9', skills: [fixture.summary] };
    },
    detail: (id) => (id === fixture.detail.skill_id ? fixture.detail : null),
  });
  const pluginRoot = mkdtempSync(path.join(tmpdir(), 'lore-claude-plugin-root-'));
  try {
    const startedAt = Date.now();
    const result = await runHook(rulesHook, { session_id: 's1', hook_event_name: 'SessionStart' }, {
      LORE_BASE_URL: server.baseUrl,
      LORE_SKILLS_ENABLED: '1',
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    });
    const hookDurationMs = Date.now() - startedAt;

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, 'BOOT');
    assert.ok(hookDurationMs < LIST_DELAY_MS, `hook waited for the sync: ${hookDurationMs}ms`);

    const status = await waitForStatusFile(pluginRoot);
    assert.equal(status.project_id, 'proj-1');
    assert.equal(status.catalog_revision, 'rev-9');
    assert.deepEqual(status.created, ['synced-skill']);
    assert.deepEqual(status.errors, []);
    assert.equal(status.skipped, undefined);
    assert.ok(status.finished_at.length > 0);
    const skillDir = path.join(pluginRoot, 'skills', 'synced-skill');
    assert.equal(readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8'), '# Synced Skill\n\nDo it natively.\n');
    const marker = JSON.parse(readFileSync(path.join(skillDir, '.lore-skill-marker.json'), 'utf-8'));
    assert.equal(marker.skill_id, fixture.detail.skill_id);
    assert.equal(marker.project_id, 'proj-1');
    assert.equal(server.requests[0].features, undefined);
    assert.equal(server.skillRequests[0].query.client_type, 'claudecode');
    assert.equal(server.skillRequests[0].query.include_user_only, undefined);
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
    await server.close();
  }
});

test('skills-sync.mjs syncs and records status on its own', async () => {
  const fixture = syncedSkillFixture();
  const server = await withServer(null, {
    list: () => ({ project_id: 'proj-1', catalog_revision: 'rev-3', skills: [fixture.summary] }),
    detail: (id) => (id === fixture.detail.skill_id ? fixture.detail : null),
  });
  const pluginRoot = mkdtempSync(path.join(tmpdir(), 'lore-claude-plugin-root-'));
  try {
    const code = await runSyncScript(pluginRoot, { LORE_BASE_URL: server.baseUrl });
    assert.equal(code, 0);
    const status = JSON.parse(readFileSync(path.join(pluginRoot, 'skills', '.lore-sync-status.json'), 'utf-8'));
    assert.deepEqual(status.created, ['synced-skill']);
    assert.deepEqual(status.errors, []);
    assert.equal(readFileSync(path.join(pluginRoot, 'skills', 'synced-skill', 'SKILL.md'), 'utf-8'), '# Synced Skill\n\nDo it natively.\n');
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
    await server.close();
  }
});

test('skills-sync.mjs records server failures and still exits 0', async () => {
  const pluginRoot = mkdtempSync(path.join(tmpdir(), 'lore-claude-plugin-root-'));
  try {
    const code = await runSyncScript(pluginRoot, { LORE_BASE_URL: 'http://127.0.0.1:9' }); // nothing listens here
    assert.equal(code, 0);
    const status = JSON.parse(readFileSync(path.join(pluginRoot, 'skills', '.lore-sync-status.json'), 'utf-8'));
    assert.equal(status.created.length, 0);
    assert.equal(status.errors.length, 1);
    assert.ok(status.errors[0].message.length > 0);
    assert.ok(status.finished_at.length > 0);
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('SessionStart stays silent when the Lore server is unavailable', async () => {
  const pluginRoot = mkdtempSync(path.join(tmpdir(), 'lore-claude-plugin-root-'));
  try {
    const result = await runHook(rulesHook, { session_id: 's1', hook_event_name: 'SessionStart' }, {
      LORE_BASE_URL: 'http://127.0.0.1:9', // nothing listens here
      LORE_SKILLS_ENABLED: '1',
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '');
    // The detached sync child records the failure and exits cleanly.
    const status = await waitForStatusFile(pluginRoot);
    assert.equal(status.errors.length, 1);
    assert.equal(status.created.length, 0);
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('Skills stay off unless the configured server advertises them', async () => {
  const server = await withServer();
  const home = mkdtempSync(path.join(tmpdir(), 'lore-claude-hook-profile-'));
  try {
    mkdirSync(path.join(home, '.lore'));
    writeFileSync(path.join(home, '.lore', 'config.json'), JSON.stringify({
      base_url: server.baseUrl,
      server_profile: { base_url: `${server.baseUrl}/`, capabilities: { skills: true } },
    }));
    await runHook(rulesHook, { session_id: 's1' }, { HOME: home });
    await runHook(recallHook, { prompt: 'hello', session_id: 's1' }, { HOME: home, LORE_SKILLS_ENABLED: '0' });
    await runHook(recallHook, { prompt: 'hello', session_id: 's1' }, { LORE_BASE_URL: server.baseUrl });
    assert.deepEqual(server.requests.map((body) => body.features), [undefined, undefined, undefined]);
  } finally {
    rmSync(home, { recursive: true, force: true });
    await server.close();
  }
});

test('lifecycle runtime reports the plugin manifest version', async () => {
  const server = await withServer();
  try {
    await runHook(rulesHook, { session_id: 's1', hook_event_name: 'SessionStart' }, {
      LORE_BASE_URL: server.baseUrl,
    });
    await runHook(recallHook, { prompt: 'hello', session_id: 's1' }, {
      LORE_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests.length, 2);
    for (const body of server.requests) {
      assert.equal(body.runtime.runtime_id, 'claudecode');
      assert.equal(body.runtime.runtime_family, 'claudecode');
      assert.equal(body.runtime.plugin_version, pluginVersion);
    }
  } finally {
    await server.close();
  }
});

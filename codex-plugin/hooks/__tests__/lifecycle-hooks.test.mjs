import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { computeManifestHash, sha256Text } from '../vendor/skill-workcopy/index.mjs';

const hooksDir = path.resolve(import.meta.dirname, '..');
const scriptsDir = path.resolve(import.meta.dirname, '../../scripts');
const recallHook = path.join(hooksDir, 'recall-inject.mjs');
const rulesHook = path.join(hooksDir, 'rules-inject.mjs');
const installHooksScript = path.join(scriptsDir, 'install-hooks.sh');
const pluginVersion = JSON.parse(
  readFileSync(path.join(hooksDir, '..', '.codex-plugin', 'plugin.json'), 'utf8'),
).version;
const isolatedHome = mkdtempSync(path.join(tmpdir(), 'lore-codex-hook-home-'));

/** Server-side skill packages used by the native-sync tests. */
function syncedSkillFixtures() {
  const build = (overrides = {}) => {
    const content = overrides.content ?? '# Synced Skill\n\nDo it natively.\n';
    const extraFiles = overrides.extraFiles || [];
    const files = [
      { path: 'SKILL.md', content },
      ...extraFiles,
    ].map((file) => ({
      ...file,
      sha256: sha256Text(file.content),
      size: Buffer.byteLength(file.content, 'utf-8'),
    }));
    const manifest_hash = computeManifestHash(files.map(({ path: p, sha256, size }) => ({ path: p, sha256, size })));
    const base = {
      skill_id: overrides.skill_id || 'sk-sync-1',
      name: overrides.name || 'synced-skill',
      version: 2,
      disable_model_invocation: overrides.disable_model_invocation ?? true,
      files,
      manifest_hash,
    };
    return { detail: base, summary: { skill_id: base.skill_id, name: base.name, version: base.version, manifest_hash } };
  };
  return {
    adapted: build(),
    existing: build({
      skill_id: 'sk-yaml-1',
      name: 'yaml-skill',
      extraFiles: [{ path: 'agents/openai.yaml', content: 'policy:\n  allow_implicit_invocation: false\n  extra: keep\n' }],
    }),
  };
}

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
        return respond(200, list());
      }
      const detailMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
      if (detailMatch) {
        skillRequests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
        const detail = routes.detail || (() => null);
        const data = detail(decodeURIComponent(detailMatch[1]));
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
    // The user-level hooks directory must carry the manifest copy the hooks read
    // runtime.plugin_version from at runtime.
    const installedManifest = JSON.parse(readFileSync(path.join(codexHome, 'hooks/lore/plugin.json'), 'utf8'));
    assert.equal(installedManifest.version, pluginVersion);
    // The copied-out hook must keep its vendor skill-workcopy core and sync into
    // the real plugin root, not the copy location.
    assert.equal(existsSync(path.join(codexHome, 'hooks', 'lore', 'hooks', 'vendor', 'skill-workcopy', 'index.mjs')), true);
    const pluginRoot = path.resolve(scriptsDir, '..');
    const command = hooks.hooks.SessionStart[0].hooks[0].command;
    assert.match(command, new RegExp(`LORE_CODEX_PLUGIN_ROOT=${JSON.stringify(pluginRoot)}`));
    assert.doesNotMatch(command, new RegExp(`LORE_CODEX_PLUGIN_ROOT=${JSON.stringify(path.join(codexHome, 'hooks', 'lore'))}`));

    const pinnedRoot = path.join(root, 'cache', 'lore', 'lore', 'local');
    execFileSync('bash', [installHooksScript], {
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        LORE_CODEX_PLUGIN_ROOT: pinnedRoot,
      },
      stdio: 'pipe',
    });
    const repinned = JSON.parse(readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'));
    assert.match(
      repinned.hooks.SessionStart[0].hooks[0].command,
      new RegExp(`LORE_CODEX_PLUGIN_ROOT=${JSON.stringify(pinnedRoot)}`),
    );
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


test('Skills-enabled hooks write host output through without advertising features.skills', async () => {
  const server = await withServer((body) => ({
    host_output: {
      mode: 'stdout_json',
      value: { hookSpecificOutput: { hookEventName: body.event.native_name, additionalContext: `${body.event.name}:skills` } },
    },
  }));
  const pluginRoot = mkdtempSync(path.join(tmpdir(), 'lore-codex-plugin-root-'));
  try {
    const env = {
      LORE_BASE_URL: server.baseUrl,
      LORE_SKILLS_ENABLED: '1',
      LORE_CODEX_PLUGIN_ROOT: pluginRoot,
    };
    const start = await runHook(rulesHook, { session_id: 's1', source: 'startup' }, env);
    const prompt = await runHook(recallHook, { prompt: 'run $deploy', session_id: 's1' }, env);
    assert.equal(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, 'session.start:skills');
    assert.equal(JSON.parse(prompt.stdout).hookSpecificOutput.additionalContext, 'prompt.submit:skills');
    // Skills are synced into the plugin directory instead of the injected catalog,
    // so the lifecycle requests must not ask for skills features anymore.
    assert.deepEqual(server.requests.map((body) => body.features), [undefined, undefined]);
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
    await server.close();
  }
});

test('SessionStart syncs skills natively and adapts disable_model_invocation', async () => {
  const fixtures = syncedSkillFixtures();
  const details = new Map([
    [fixtures.adapted.detail.skill_id, fixtures.adapted.detail],
    [fixtures.existing.detail.skill_id, fixtures.existing.detail],
  ]);
  const server = await withServer(() => ({
    host_output: {
      mode: 'stdout_json',
      value: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'CODEX_BOOT' } },
    },
  }), {
    list: () => ({
      project_id: 'proj-1',
      catalog_revision: 'rev-4',
      skills: [fixtures.adapted.summary, fixtures.existing.summary],
    }),
    detail: (id) => details.get(id) || null,
  });
  const pluginRoot = mkdtempSync(path.join(tmpdir(), 'lore-codex-plugin-root-'));
  // Bundled static skill without a Lore marker: must survive the sync untouched.
  const bundled = path.join(pluginRoot, 'skills', 'lore-memory');
  mkdirSync(bundled, { recursive: true });
  writeFileSync(path.join(bundled, 'SKILL.md'), '# Bundled Lore memory skill\n');
  try {
    const result = await runHook(rulesHook, { session_id: 's1', source: 'startup' }, {
      LORE_BASE_URL: server.baseUrl,
      LORE_SKILLS_ENABLED: '1',
      LORE_CODEX_PLUGIN_ROOT: pluginRoot,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /CODEX_BOOT/);
    assert.equal(server.requests[0].features, undefined);
    assert.equal(server.skillRequests.length, 3);
    assert.equal(server.skillRequests[0].query.client_type, 'codex');
    assert.equal(server.skillRequests[0].query.include_user_only, 'true');

    const adaptedDir = path.join(pluginRoot, 'skills', 'synced-skill');
    assert.equal(readFileSync(path.join(adaptedDir, 'SKILL.md'), 'utf-8'), '# Synced Skill\n\nDo it natively.\n');
    assert.equal(
      readFileSync(path.join(adaptedDir, 'agents', 'openai.yaml'), 'utf-8'),
      'policy:\n  allow_implicit_invocation: false\n',
    );
    const marker = JSON.parse(readFileSync(path.join(adaptedDir, '.lore-skill-marker.json'), 'utf8'));
    assert.equal(marker.skill_id, fixtures.adapted.detail.skill_id);
    assert.equal(marker.project_id, 'proj-1');
    assert.deepEqual(marker.managed_files.sort(), ['SKILL.md', 'agents/openai.yaml']);
    assert.equal(marker.source_manifest_hash, fixtures.adapted.detail.manifest_hash);

    // A package that already ships agents/openai.yaml keeps it verbatim.
    assert.equal(
      readFileSync(path.join(pluginRoot, 'skills', 'yaml-skill', 'agents', 'openai.yaml'), 'utf-8'),
      'policy:\n  allow_implicit_invocation: false\n  extra: keep\n',
    );

    assert.equal(readFileSync(path.join(bundled, 'SKILL.md'), 'utf-8'), '# Bundled Lore memory skill\n');
    assert.equal(existsSync(path.join(bundled, '.lore-skill-marker.json')), false);
    assert.equal(existsSync(path.join(pluginRoot, 'skills', '.lore-sync.lock')), false);
    assert.equal(result.stderr, '');
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
    await server.close();
  }
});

test('SessionStart stays silent when the Lore server is unavailable', async () => {
  const pluginRoot = mkdtempSync(path.join(tmpdir(), 'lore-codex-plugin-root-'));
  try {
    const result = await runHook(rulesHook, { session_id: 's1', source: 'startup' }, {
      LORE_BASE_URL: 'http://127.0.0.1:9', // nothing listens here
      LORE_SKILLS_ENABLED: '1',
      LORE_CODEX_PLUGIN_ROOT: pluginRoot,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(existsSync(path.join(pluginRoot, 'skills')), false);
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('Skills stay off unless the configured server advertises them', async () => {
  const server = await withServer();
  const home = mkdtempSync(path.join(tmpdir(), 'lore-codex-hook-profile-'));
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
      LORE_CODEX_HOOK_BASE_URL: server.baseUrl,
    });
    await runHook(recallHook, { prompt: 'hello', session_id: 's1' }, {
      LORE_CODEX_HOOK_BASE_URL: server.baseUrl,
    });
    assert.equal(server.requests.length, 2);
    for (const body of server.requests) {
      assert.equal(body.runtime.runtime_id, 'codex');
      assert.equal(body.runtime.runtime_family, 'codex');
      assert.equal(body.runtime.plugin_version, pluginVersion);
    }
  } finally {
    await server.close();
  }
});

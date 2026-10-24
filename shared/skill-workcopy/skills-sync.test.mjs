/**
 * Shared skills-sync tests (node:test, dependency-free).
 * Run: node --test shared/skill-workcopy/skills-sync.test.mjs
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { computeManifestHash, sha256Text } from './index.mjs';
import { runSkillsSync } from './skills-sync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, 'skills-sync.mjs');
const STATUS_FILE = '.lore-sync-status.json';
// The host shell may carry LORE_* variables; tests resolve connections
// explicitly or through an isolated config.json.
const ENV_KEYS_TO_SCRUB = ['LORE_BASE_URL', 'LORE_API_TOKEN', 'API_TOKEN', 'LORE_HOME'];

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function scrubEnv() {
  const saved = {};
  for (const key of ENV_KEYS_TO_SCRUB) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/** Server-side skill package fixture. */
function skillFixture(overrides = {}) {
  const content = overrides.content ?? '# Synced Skill\n\nDo it natively.\n';
  const extraFiles = overrides.extraFiles || [];
  const files = [{ path: 'SKILL.md', content }, ...extraFiles].map((file) => ({
    ...file,
    sha256: sha256Text(file.content),
    size: Buffer.byteLength(file.content, 'utf-8'),
  }));
  const manifest_hash = computeManifestHash(files.map(({ path: p, sha256, size }) => ({ path: p, sha256, size })));
  const base = {
    skill_id: overrides.skill_id || 'sk-sync-1',
    name: overrides.name || 'synced-skill',
    version: 2,
    disable_model_invocation: overrides.disable_model_invocation ?? false,
    files,
    manifest_hash,
  };
  return {
    detail: base,
    summary: { skill_id: base.skill_id, name: base.name, version: base.version, manifest_hash },
  };
}

async function withServer(catalog, details) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const respond = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    requests.push({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: req.headers.authorization || '',
    });
    if (req.method === 'GET' && url.pathname === '/api/skills') return respond(200, catalog);
    const match = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
    if (req.method === 'GET' && match) {
      const detail = details?.[decodeURIComponent(match[1])];
      if (detail) return respond(200, detail);
      return respond(404, { detail: 'not found' });
    }
    return respond(404, { detail: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function runScript(args, env = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    for (const key of ENV_KEYS_TO_SCRUB) delete childEnv[key];
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: { ...childEnv, ...env },
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
}

describe('runSkillsSync', () => {
  let restoreEnv;
  let loreHome;
  let root;

  beforeEach(() => {
    restoreEnv = scrubEnv();
    loreHome = makeTempDir('lore-skills-sync-home-');
    root = makeTempDir('lore-skills-sync-root-');
  });

  afterEach(() => {
    restoreEnv();
    rmTempDir(loreHome);
    rmTempDir(root);
  });

  function writeConfig(baseUrl, apiToken) {
    fs.mkdirSync(loreHome, { recursive: true });
    fs.writeFileSync(path.join(loreHome, 'config.json'), JSON.stringify({
      base_url: baseUrl,
      ...(apiToken ? { api_token: apiToken } : {}),
    }), 'utf-8');
  }

  function readStatusFile() {
    return JSON.parse(fs.readFileSync(path.join(root, STATUS_FILE), 'utf-8'));
  }

  it('syncs the whole catalog using the loreHome config and writes the status file', async () => {
    const fixture = skillFixture();
    const server = await withServer(
      { project_id: 'proj-1', catalog_revision: 'rev-7', skills: [fixture.summary] },
      { [fixture.detail.skill_id]: fixture.detail },
    );
    try {
      writeConfig(server.baseUrl, 'tok-1');
      const status = await runSkillsSync({ clientType: 'pi', root, loreHome });

      assert.deepEqual(status.created, ['synced-skill']);
      assert.equal(status.project_id, 'proj-1');
      assert.equal(status.catalog_revision, 'rev-7');
      assert.deepEqual(status.errors, []);
      assert.ok(status.finished_at.length > 0);
      assert.deepEqual(readStatusFile(), status);

      assert.equal(
        fs.readFileSync(path.join(root, 'synced-skill', 'SKILL.md'), 'utf-8'),
        '# Synced Skill\n\nDo it natively.\n',
      );
      const marker = JSON.parse(fs.readFileSync(path.join(root, 'synced-skill', '.lore-skill-marker.json'), 'utf-8'));
      assert.equal(marker.project_id, 'proj-1');

      // Catalog request: client_type set, credentials from config, no include_user_only.
      assert.equal(server.requests[0].path, '/api/skills');
      assert.equal(server.requests[0].query.client_type, 'pi');
      assert.equal(server.requests[0].query.include_user_only, undefined);
      assert.equal(server.requests[0].authorization, 'Bearer tok-1');
      // Detail request carries the same client_type.
      assert.equal(server.requests[1].query.client_type, 'pi');
    } finally {
      await server.close();
    }
  });

  it('adapts codex packages and keeps bundled lore-memory out of conflicts', async () => {
    const adapted = skillFixture();
    const existing = skillFixture({
      skill_id: 'sk-yaml-1',
      name: 'yaml-skill',
      disable_model_invocation: true,
      extraFiles: [{ path: 'agents/openai.yaml', content: 'policy:\n  allow_implicit_invocation: false\n  extra: keep\n' }],
    });
    const bundled = skillFixture({ skill_id: 'sk-bundled-1', name: 'lore-memory' });
    // Bundled static lore-memory dir without a Lore marker.
    fs.mkdirSync(path.join(root, 'lore-memory'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lore-memory', 'SKILL.md'), '# Bundled\n');

    const server = await withServer(
      { project_id: 'proj-1', catalog_revision: 'rev-2', skills: [adapted.summary, existing.summary, bundled.summary] },
      {
        [adapted.detail.skill_id]: { ...adapted.detail, disable_model_invocation: true },
        [existing.detail.skill_id]: existing.detail,
        [bundled.detail.skill_id]: bundled.detail,
      },
    );
    try {
      const status = await runSkillsSync({ clientType: 'codex', root, loreHome, baseUrl: server.baseUrl });
      assert.deepEqual(status.created.sort(), ['synced-skill', 'yaml-skill']);
      assert.deepEqual(status.errors, []);
      // lore-memory collides with the bundled unmarked dir but is an expected conflict.
      assert.deepEqual(status.conflicts, []);
      assert.deepEqual(readStatusFile().conflicts, status.conflicts);

      // disable_model_invocation without a package yaml gets the policy appended.
      assert.equal(
        fs.readFileSync(path.join(root, 'synced-skill', 'agents', 'openai.yaml'), 'utf-8'),
        'policy:\n  allow_implicit_invocation: false\n',
      );
      // A package that already ships agents/openai.yaml keeps it verbatim.
      assert.equal(
        fs.readFileSync(path.join(root, 'yaml-skill', 'agents', 'openai.yaml'), 'utf-8'),
        'policy:\n  allow_implicit_invocation: false\n  extra: keep\n',
      );
      // The bundled dir is never touched.
      assert.equal(fs.readFileSync(path.join(root, 'lore-memory', 'SKILL.md'), 'utf-8'), '# Bundled\n');
    } finally {
      await server.close();
    }
  });

  it('records server failures in the status file instead of throwing', async () => {
    const status = await runSkillsSync({
      clientType: 'pi',
      root,
      loreHome,
      baseUrl: 'http://127.0.0.1:9', // nothing listens here
    });
    assert.deepEqual(status.created, []);
    assert.equal(status.errors.length, 1);
    assert.ok(status.errors[0].message.length > 0);
    assert.ok(status.finished_at.length > 0);
    assert.deepEqual(readStatusFile().errors, status.errors);
  });

  it('runs as a standalone script and exits 0', async () => {
    const fixture = skillFixture();
    const server = await withServer(
      { project_id: 'proj-1', catalog_revision: 'rev-1', skills: [fixture.summary] },
      { [fixture.detail.skill_id]: fixture.detail },
    );
    try {
      writeConfig(server.baseUrl);
      const code = await runScript([
        '--client-type', 'pi',
        '--root', root,
        '--lore-home', loreHome,
      ]);
      assert.equal(code, 0);
      const status = readStatusFile();
      assert.deepEqual(status.created, ['synced-skill']);
      assert.deepEqual(status.errors, []);
      assert.equal(status.project_id, 'proj-1');
    } finally {
      await server.close();
    }
  });
});

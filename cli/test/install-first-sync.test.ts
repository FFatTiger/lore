import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInstall } from '../src/commands/install.ts';
import { runFirstSkillsSync } from '../src/core/skills-first-sync.ts';
import { parseArgv } from '../src/core/args.ts';
import type { ChannelResult } from '../src/core/types.ts';

const CATALOG = {
  project_id: 'proj-1',
  catalog_revision: 'rev-1',
  skills: [{ skill_id: 'skill-1', name: 'demo-skill', version: '1.0.0' }],
};

const DETAIL = {
  skill_id: 'skill-1',
  name: 'demo-skill',
  version: '1.0.0',
  files: [
    {
      path: 'SKILL.md',
      content: '---\nname: demo-skill\n---\nDemo skill body.\n',
    },
  ],
};

/** Local stand-in for the Lore server: only the skills catalog endpoints. */
async function startSkillsServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }
    if (url.pathname === '/api/skills') return send(CATALOG);
    if (url.pathname === '/api/skills/skill-1') return send(DETAIL);
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function recordLogger(lines: string[]) {
  const record = (msg: string) => { lines.push(msg); };
  return { info: record, ok: record, warn: record, err: record, section: record };
}

const artifactRun = async (argv: string[]) => {
  if (argv[0] === 'curl') {
    const out = argv[argv.indexOf('-o') + 1];
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, 'zip');
  }
  if (argv[0] === 'unzip') {
    await fs.mkdir(path.join(argv[argv.indexOf('-d') + 1], 'lore_memory'), { recursive: true });
  }
  return { code: 0, stdout: '', stderr: '' };
};

test('install runs the first skills sync for installed channels', async () => {
  const { server, baseUrl } = await startSkillsServer();
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-first-sync-'));
  const lines: string[] = [];
  try {
    const exit = await runInstall(
      parseArgv([
        'install',
        '--base-url',
        baseUrl,
        '--api-token',
        'lm_test',
        '--channels',
        'hermes',
        '--skip-docker',
      ]),
      {
        isTTY: false,
        env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
        log: recordLogger(lines),
        run: async () => ({ code: 0, stdout: '', stderr: '' }),
        artifactRun,
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes('/api/health')) {
            return new Response(JSON.stringify({ ok: true, capabilities: { skills: true } }), { status: 200 });
          }
          if (url.includes('api.github.com')) {
            return new Response(JSON.stringify({ tag_name: 'v1.3.15' }), { status: 200 });
          }
          return new Response('ok', { status: 200 });
        },
      },
    );
    assert.equal(exit, 0);
    assert.ok(lines.includes('Skills: 1 synced → Hermes'), lines.join('\n'));
    assert.ok(lines.some((line) => line.includes('documents/skills')), lines.join('\n'));
    const root = path.join(loreHome, 'skills', 'proj-1');
    await fs.access(path.join(root, 'demo-skill', 'SKILL.md'));
    await fs.access(path.join(root, '.lore-sync-status.json'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('install still succeeds when the skills catalog is unreachable', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-first-sync-down-'));
  const lines: string[] = [];
  const exit = await runInstall(
    parseArgv([
      'install',
      '--base-url',
      'https://core.example',
      '--api-token',
      'lm_test',
      '--channels',
      'hermes',
      '--skip-docker',
    ]),
    {
      isTTY: false,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
      log: recordLogger(lines),
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
      artifactRun,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('/api/health')) {
          return new Response(JSON.stringify({ ok: true, capabilities: { skills: true } }), { status: 200 });
        }
        if (url.includes('api.github.com')) {
          return new Response(JSON.stringify({ tag_name: 'v1.3.15' }), { status: 200 });
        }
        return new Response('ok', { status: 200 });
      },
    },
  );
  assert.equal(exit, 0);
  assert.ok(!lines.some((line) => line.includes('synced →')), lines.join('\n'));
  assert.ok(lines.some((line) => line.includes('Skills sync failed')), lines.join('\n'));
});

test('first sync writes opencode skills under XDG_CONFIG_HOME and defaults to ~/.config', async () => {
  const { server, baseUrl } = await startSkillsServer();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-first-sync-oc-'));
  const loreHome = path.join(home, '.lore');
  await fs.mkdir(loreHome, { recursive: true });
  const xdg = path.join(home, 'xdg');
  const lines: string[] = [];
  try {
    await runFirstSkillsSync({
      results: [{ id: 'opencode', status: 'ok' }],
      loreHome,
      baseUrl,
      apiToken: 'lm_test',
      homeDir: home,
      env: { XDG_CONFIG_HOME: xdg },
      log: recordLogger(lines),
    });
    assert.ok(lines.includes('Skills: 1 synced → OpenCode'), lines.join('\n'));
    await fs.access(path.join(xdg, 'opencode', 'skills', 'demo-skill', 'SKILL.md'));
    await fs.access(path.join(xdg, 'opencode', 'skills', '.lore-sync-status.json'));

    lines.length = 0;
    await runFirstSkillsSync({
      results: [{ id: 'opencode', status: 'ok' }],
      loreHome,
      baseUrl,
      apiToken: 'lm_test',
      homeDir: home,
      env: {},
      log: recordLogger(lines),
    });
    await fs.access(path.join(home, '.config', 'opencode', 'skills', 'demo-skill', 'SKILL.md'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('first sync uses the Claude Code installed plugin path and skips when absent', async () => {
  const { server, baseUrl } = await startSkillsServer();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-first-sync-cc-'));
  const loreHome = path.join(home, '.lore');
  await fs.mkdir(loreHome, { recursive: true });
  const results: ChannelResult[] = [{ id: 'claudecode', status: 'ok' }];
  const lines: string[] = [];
  try {
    await runFirstSkillsSync({
      results,
      loreHome,
      baseUrl,
      apiToken: 'lm_test',
      homeDir: home,
      env: {},
      log: recordLogger(lines),
    });
    assert.ok(lines.some((line) => line.includes('plugin path not found yet')), lines.join('\n'));
    assert.ok(!lines.some((line) => line.includes('synced →')), lines.join('\n'));

    const pluginsFile = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
    await fs.mkdir(path.dirname(pluginsFile), { recursive: true });
    const installPath = path.join(home, '.claude', 'plugins', 'cache', 'lore', 'lore', '1.2.3');
    await fs.writeFile(pluginsFile, JSON.stringify({ 'lore@lore': { installPath } }));
    lines.length = 0;
    await runFirstSkillsSync({
      results,
      loreHome,
      baseUrl,
      apiToken: 'lm_test',
      homeDir: home,
      env: {},
      log: recordLogger(lines),
    });
    assert.ok(lines.includes('Skills: 1 synced → Claude Code'), lines.join('\n'));
    await fs.access(path.join(installPath, 'skills', 'demo-skill', 'SKILL.md'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

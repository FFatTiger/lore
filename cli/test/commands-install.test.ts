import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInstall } from '../src/commands/install.ts';
import { parseArgv } from '../src/core/args.ts';
import { getConfigPath } from '../src/core/paths.ts';
import { readConfig, writeConfig } from '../src/core/config.ts';
import type { PromptService } from '../src/ui/prompt.ts';
import type { ExecFn } from '../src/core/exec.ts';

function stableRelease(version = 'v1.3.19'): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.endsWith('/releases/latest')) {
      return new Response(null, {
        status: 302,
        headers: { location: `https://github.com/FFatTiger/lore/releases/tag/${version}` },
      });
    }
    return new Response('ok', { status: 200 });
  };
}

function artifactRun(): ExecFn {
  return async (argv) => {
    if (argv[0] === 'curl') {
      const out = argv[argv.indexOf('-o') + 1];
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, 'zip');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'unzip') {
      const dir = argv[argv.indexOf('-d') + 1];
      await fs.mkdir(path.join(dir, 'lore_memory'), { recursive: true });
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

test('non-TTY bare argv exits 2', async () => {
  const args = parseArgv([]);
  const exit = await runInstall(args, {
    isTTY: false,
    env: { ...process.env, LORE_HOME: await fs.mkdtemp(path.join(os.tmpdir(), 'lore-ntty-')) },
  });
  assert.equal(exit, 2);
});

test('flag install with mocked deps writes config', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-inst-'));
  const args = parseArgv([
    'install',
    '--base-url',
    'https://core.example',
    '--api-token',
    'lm_test',
    '--channels',
    'hermes',
    '--skip-docker',
  ]);

  const runExec = async (argv: string[]) => {
    if (argv[0] === 'curl') {
      const out = argv[argv.indexOf('-o') + 1];
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, 'zip');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'unzip') {
      const dir = argv[argv.indexOf('-d') + 1];
      await fs.mkdir(path.join(dir, 'lore_memory'), { recursive: true });
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const exit = await runInstall(args, {
    isTTY: false,
    env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
    artifactRun: runExec,
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
    fetchImpl: async (url) => {
      if (String(url).includes('api.github.com')) {
        return new Response(JSON.stringify({ tag_name: 'v1.3.15' }), { status: 200 });
      }
      return new Response('ok', { status: 200 });
    },
  });

  assert.equal(exit, 0);
  const cfg = await readConfig(getConfigPath(loreHome));
  assert.equal(cfg.base_url, 'https://core.example');
  assert.equal(cfg.api_token, 'lm_test');
  await fs.access(path.join(loreHome, 'hermes', 'lore_memory'));
});

test('interactive SaaS path never asks base URL and uses api.loremem.com', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-saas-'));
  let askedBaseUrl = false;
  const prompt: PromptService = {
    async pickLanguage() {
      return 'en';
    },
    showStatus() {},
    async pickFirstRunAction() {
      return 'saas';
    },
    async pickExistingAction() {
      return 'update';
    },
    async askBaseUrl() {
      askedBaseUrl = true;
      return 'should-not-be-used';
    },
    async askToken() {
      return 'lm_saas_token';
    },
    async pickChannels() {
      return ['hermes'];
    },
    async pickRelease() {
      return 'stable';
    },
    async confirm() {
      return true;
    },
    async askYesNo() {
      return false;
    },
  };

  const runExec = async (argv: string[]) => {
    if (argv[0] === 'curl') {
      const out = argv[argv.indexOf('-o') + 1];
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, 'zip');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'unzip') {
      const dir = argv[argv.indexOf('-d') + 1];
      await fs.mkdir(path.join(dir, 'lore_memory'), { recursive: true });
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const exit = await runInstall(parseArgv([]), {
    isTTY: true,
    prompt,
    env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
    artifactRun: runExec,
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
    fetchImpl: async (url) => {
      if (String(url).includes('api.github.com')) {
        return new Response(JSON.stringify({ tag_name: 'v1.3.16' }), { status: 200 });
      }
      return new Response('ok', { status: 200 });
    },
    log: {
      info() {},
      ok() {},
      warn() {},
      err() {},
      section() {},
    },
  });

  assert.equal(exit, 0);
  assert.equal(askedBaseUrl, false);
  const cfg = await readConfig(getConfigPath(loreHome));
  assert.equal(cfg.base_url, 'https://api.loremem.com');
  assert.equal(cfg.api_token, 'lm_saas_token');
});

test('same explicit base keeps a saved token when no new token is supplied', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-same-origin-'));
  await writeConfig(
    getConfigPath(loreHome),
    { base_url: 'https://core.example/', api_token: 'lm_old' },
    { tokenAction: 'set' },
  );

  const exit = await runInstall(
    parseArgv([
      'install',
      '--base-url',
      'https://CORE.example/',
      '--channels',
      'hermes',
      '--skip-docker',
    ]),
    {
      isTTY: false,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
      artifactRun: artifactRun(),
      fetchImpl: stableRelease(),
    },
  );

  assert.equal(exit, 0);
  const cfg = await readConfig(getConfigPath(loreHome));
  assert.equal(cfg.base_url, 'https://core.example');
  assert.equal(cfg.api_token, 'lm_old');
});

test('changed explicit base clears a saved token', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-changed-origin-'));
  await writeConfig(
    getConfigPath(loreHome),
    { base_url: 'https://api.loremem.com', api_token: 'lm_old' },
    { tokenAction: 'set' },
  );

  const exit = await runInstall(
    parseArgv([
      'install',
      '--base-url',
      'https://other.example',
      '--channels',
      'hermes',
      '--skip-docker',
    ]),
    {
      isTTY: false,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
      artifactRun: artifactRun(),
      fetchImpl: stableRelease(),
    },
  );

  assert.equal(exit, 0);
  const cfg = await readConfig(getConfigPath(loreHome));
  assert.equal(cfg.base_url, 'https://other.example');
  assert.equal(cfg.api_token, undefined);
});

test('non-interactive SaaS install without a token fails before channel effects', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-saas-required-'));
  const exit = await runInstall(
    parseArgv([
      'install',
      '--base-url',
      'https://api.loremem.com',
      '--channels',
      'hermes',
      '--skip-docker',
    ]),
    {
      isTTY: false,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
      artifactRun: artifactRun(),
      fetchImpl: stableRelease(),
    },
  );

  assert.equal(exit, 2);
  await assert.rejects(fs.access(path.join(loreHome, 'hermes')));
});

test('non-loopback HTTP with a token fails before channel effects', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-insecure-http-'));
  const exit = await runInstall(
    parseArgv([
      'install',
      '--base-url',
      'http://192.168.1.5:18901',
      '--api-token',
      'lm_x',
      '--channels',
      'hermes',
      '--skip-docker',
    ]),
    {
      isTTY: false,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
      artifactRun: artifactRun(),
      fetchImpl: stableRelease(),
    },
  );

  assert.equal(exit, 2);
  await assert.rejects(fs.access(path.join(loreHome, 'hermes')));
});

test('interactive Docker reconfigure ignores saved SaaS connection and clears token', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-reconfigure-'));
  await writeConfig(
    getConfigPath(loreHome),
    { base_url: 'https://api.loremem.com', api_token: 'lm_old' },
    { tokenAction: 'set', dockerManaged: false },
  );

  const prompt: PromptService = {
    async pickLanguage() { return 'en'; },
    showStatus() {},
    async pickFirstRunAction() { return 'docker'; },
    async pickExistingAction() { return 'reconfigure'; },
    async askBaseUrl() { return 'unused'; },
    async askToken() { return ''; },
    async pickChannels() { return ['hermes']; },
    async pickRelease() { return 'stable'; },
    async confirm() { return true; },
    async askYesNo() { return false; },
  };

  const run: ExecFn = async (argv) => {
    if (argv[0] === 'docker') return { code: 0, stdout: '', stderr: '' };
    return artifactRun()(argv);
  };
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('docker-compose.yml')) {
      return new Response('services:\n  web:\n    image: fffattiger/lore:latest\n', { status: 200 });
    }
    if (url.includes('/api/health')) return new Response('ok', { status: 200 });
    return stableRelease()(input);
  };

  const exit = await runInstall(parseArgv([]), {
    isTTY: true,
    prompt,
    env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
    run,
    artifactRun: artifactRun(),
    fetchImpl,
    log: { info() {}, ok() {}, warn() {}, err() {}, section() {} },
  });

  assert.equal(exit, 0);
  const cfg = await readConfig(getConfigPath(loreHome));
  assert.equal(cfg.base_url, 'http://127.0.0.1:18901');
  assert.equal(cfg.api_token, undefined);
  assert.equal(cfg.docker_managed, true);
});

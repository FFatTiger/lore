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

test('non-loopback HTTP with a token succeeds only with the explicit per-run flag', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-insecure-http-allowed-'));
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
      '--allow-insecure-http',
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
  assert.equal(cfg.base_url, 'http://192.168.1.5:18901');
  assert.equal(cfg.api_token, 'lm_x');
  assert.equal('allow_insecure_http' in cfg, false);
  await fs.access(path.join(loreHome, 'hermes'));
});

test('interactive insecure HTTP approval propagates through the execution safety gate', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-insecure-http-wizard-'));
  let riskConfirmed = false;
  const prompt: PromptService = {
    async pickLanguage() { return 'en'; },
    showStatus() {},
    async pickFirstRunAction() { return 'external'; },
    async pickExistingAction() { return 'update'; },
    async askBaseUrl() { return 'http://192.168.1.5:18901'; },
    async askToken() { return 'lm_x'; },
    async pickChannels() { return ['hermes']; },
    async pickRelease() { return 'stable'; },
    async confirm() { return true; },
    async askYesNo(question, defaultYes) {
      assert.equal(defaultYes, false);
      assert.match(question, /http:\/\/192\.168\.1\.5:18901/);
      riskConfirmed = true;
      return true;
    },
  };

  const exit = await runInstall(parseArgv([]), {
    isTTY: true,
    prompt,
    env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
    artifactRun: artifactRun(),
    fetchImpl: stableRelease(),
    log: { info() {}, ok() {}, warn() {}, err() {}, section() {} },
  });

  assert.equal(exit, 0);
  assert.equal(riskConfirmed, true);
  const cfg = await readConfig(getConfigPath(loreHome));
  assert.equal(cfg.base_url, 'http://192.168.1.5:18901');
  assert.equal(cfg.api_token, 'lm_x');
  assert.equal('allow_insecure_http' in cfg, false);
});

test('--yes does not authorize non-loopback HTTP with a token', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-insecure-http-yes-'));
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
      '--yes',
    ]),
    {
      isTTY: true,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
      prompt: {
        async pickLanguage() { throw new Error('parameter mode must not prompt'); },
        showStatus() { throw new Error('parameter mode must not prompt'); },
        async pickFirstRunAction() { throw new Error('parameter mode must not prompt'); },
        async pickExistingAction() { throw new Error('parameter mode must not prompt'); },
        async askBaseUrl() { throw new Error('parameter mode must not prompt'); },
        async askToken() { throw new Error('parameter mode must not prompt'); },
        async pickChannels() { throw new Error('parameter mode must not prompt'); },
        async pickRelease() { throw new Error('parameter mode must not prompt'); },
        async confirm() { throw new Error('parameter mode must not prompt'); },
        async askYesNo() { throw new Error('parameter mode must not prompt'); },
      },
      artifactRun: artifactRun(),
      fetchImpl: stableRelease(),
    },
  );

  assert.equal(exit, 2);
  await assert.rejects(fs.access(path.join(loreHome, 'hermes')));
});

function recordingPrompt(calls: string[], over: Partial<PromptService> = {}): PromptService {
  return {
    async pickLanguage(def) { calls.push('lang'); return def; },
    showStatus() { calls.push('status'); },
    async pickFirstRunAction(opts) { calls.push(`first:${opts?.initial ?? ''}`); return opts?.initial ?? 'external'; },
    async pickExistingAction(initial = 'update') { calls.push(`existing:${initial}`); return initial; },
    async askBaseUrl(def = '') { calls.push(`url:${def}`); return def; },
    async askToken() { calls.push('token'); return ''; },
    async pickChannels(opts) { calls.push(`channels:${opts.defaults.join(',')}`); return opts.defaults; },
    async pickRelease(def = 'stable') { calls.push(`release:${def}`); return def; },
    async confirm() { calls.push('confirm'); return false; },
    async askYesNo(_q, def = true) { calls.push('yesno'); return def; },
    ...over,
  };
}

test('TTY install with flags opens the wizard with flag values preselected', async () => {
  for (const argv of [
    ['install'],
    ['--lang', 'zh'],
    ['install', '--base-url', 'https://core.example', '--channels', 'hermes', '--pre'],
  ]) {
    const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-tty-wizard-'));
    const calls: string[] = [];
    const exit = await runInstall(parseArgv(argv), {
      isTTY: true,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome, LORE_INSTALL_LANG: 'en' },
      prompt: recordingPrompt(calls),
      run: async () => { throw new Error('wizard declined; nothing may run'); },
      fetchImpl: stableRelease(),
      log: { info() {}, ok() {}, warn() {}, err() {}, section() {} },
    });
    assert.equal(exit, 1, argv.join(' '));
    assert.ok(calls.includes('status'), argv.join(' '));
    if (argv.includes('--base-url')) {
      assert.ok(calls.includes('first:external'));
      assert.ok(calls.includes('url:https://core.example'));
      assert.ok(calls.includes('channels:hermes'));
      assert.ok(calls.includes('release:pre'));
    }
  }
});

test('non-interactive install without a server errors instead of deploying Docker', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-no-server-'));
  const ran: string[] = [];
  const errors: string[] = [];
  const exit = await runInstall(parseArgv(['install', '--yes', '--channels', 'hermes']), {
    isTTY: true,
    env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
    run: async (argv) => { ran.push(argv.join(' ')); return { code: 0, stdout: '', stderr: '' }; },
    fetchImpl: stableRelease(),
    log: { info() {}, ok() {}, warn() {}, err(m: string) { errors.push(m); }, section() {} },
  });
  assert.equal(exit, 2);
  assert.deepEqual(ran, []);
  assert.match(errors.join('\n'), /--base-url.*--docker/);
  await assert.rejects(fs.access(path.join(loreHome, 'docker')));
});

test('non-interactive install defaults to detected runtimes only', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-detected-'));
  const bin = path.join(loreHome, 'bin');
  await fs.mkdir(bin, { recursive: true });
  const exe = path.join(bin, process.platform === 'win32' ? 'hermes.cmd' : 'hermes');
  await fs.writeFile(exe, process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') await fs.chmod(exe, 0o755);
  const infos: string[] = [];
  const exit = await runInstall(
    parseArgv(['-y', '--base-url', 'https://core.example']),
    {
      isTTY: false,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome, PATH: bin, Path: bin },
      artifactRun: artifactRun(),
      fetchImpl: stableRelease(),
      log: { info(m: string) { infos.push(m); }, ok() {}, warn() {}, err() {}, section() {} },
    },
  );
  assert.equal(exit, 0);
  assert.ok(infos.some((m) => /^Channels: hermes \(/.test(m)), infos.join('\n'));
});

test('non-interactive install with nothing detected asks for --channels', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-none-detected-'));
  const empty = path.join(loreHome, 'empty-bin');
  await fs.mkdir(empty, { recursive: true });
  const exit = await runInstall(
    parseArgv(['-y', '--base-url', 'https://core.example']),
    {
      isTTY: false,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome, PATH: empty, Path: empty },
      fetchImpl: stableRelease(),
      log: { info() {}, ok() {}, warn() {}, err() {}, section() {} },
    },
  );
  assert.equal(exit, 2);
});

test('TTY install with --yes stays parameter mode and never opens the wizard', async () => {
  for (const argv of [['install', '--yes', '--docker', '--channels', 'hermes']]) {
    const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-tty-flags-'));
    const exit = await runInstall(parseArgv(argv), {
      isTTY: true,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
      prompt: {
        async pickLanguage() { throw new Error('parameter mode must not prompt'); },
        showStatus() { throw new Error('parameter mode must not prompt'); },
        async pickFirstRunAction() { throw new Error('parameter mode must not prompt'); },
        async pickExistingAction() { throw new Error('parameter mode must not prompt'); },
        async askBaseUrl() { throw new Error('parameter mode must not prompt'); },
        async askToken() { throw new Error('parameter mode must not prompt'); },
        async pickChannels() { throw new Error('parameter mode must not prompt'); },
        async pickRelease() { throw new Error('parameter mode must not prompt'); },
        async confirm() { throw new Error('parameter mode must not prompt'); },
        async askYesNo() { throw new Error('parameter mode must not prompt'); },
      },
      run: async (command) => command[0] === 'docker'
        ? { code: 1, stdout: '', stderr: 'docker unavailable' }
        : { code: 0, stdout: '', stderr: '' },
      fetchImpl: stableRelease(),
    });
    assert.equal(exit, 1);
  }
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

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInstall, runUpdate } from '../src/commands/install.ts';
import { parseArgv } from '../src/core/args.ts';
import { getConfigPath } from '../src/core/paths.ts';
import { readConfig, writeConfig } from '../src/core/config.ts';

async function withPathBins<T>(
  home: string,
  names: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const bin = path.join(home, 'bin');
  await fs.mkdir(bin, { recursive: true });
  for (const name of names) {
    await fs.writeFile(path.join(bin, name), '#!/bin/bash\nexit 0\n');
    await fs.chmod(path.join(bin, name), 0o755);
  }
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous ?? ''}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = previous;
  }
}

function silentLog() {
  const lines: string[] = [];
  return {
    lines,
    log: {
      info: (m: string) => lines.push(`info:${m}`),
      ok: (m: string) => lines.push(`ok:${m}`),
      warn: (m: string) => lines.push(`warn:${m}`),
      err: (m: string) => lines.push(`err:${m}`),
      section: (m: string) => lines.push(`section:${m}`),
    },
  };
}

test('when all channel downloads fail, does not report install complete', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-fail-'));
  const { lines, log } = silentLog();
  const args = parseArgv([
    'install',
    '--base-url',
    'https://api.loremem.com',
    '--api-token',
    'lm_x',
    '--channels',
    'pi,codex',
    '--skip-docker',
  ]);

  const exit = await runInstall(args, {
    isTTY: false,
    env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
    log,
    // No release tag + curl fails
    fetchImpl: async () => {
      throw new Error('rate limited');
    },
    run: async () => ({ code: 22, stdout: '', stderr: 'curl 404' }),
  });

  assert.equal(exit, 1);
  assert.ok(lines.some((l) => l.startsWith('err:') && /failed|失败/i.test(l)));
  assert.ok(!lines.some((l) => l.startsWith('ok:') && /Install complete|安装完成/.test(l)));
});

test('when release unknown, surfaces explicit release error before channels', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-rel-'));
  const { lines, log } = silentLog();
  const exit = await runInstall(
    parseArgv([
      'install',
      '--base-url',
      'https://api.loremem.com',
      '--api-token',
      'lm_x',
      '--channels',
      'hermes',
      '--skip-docker',
    ]),
    {
      isTTY: false,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
      log,
      fetchImpl: async () => {
        throw new Error('offline');
      },
      run: async () => ({ code: 1, stdout: '', stderr: '' }),
    },
  );
  assert.equal(exit, 1);
  assert.ok(lines.some((l) => /release|GitHub|版本/i.test(l)));
});

test('update fails immediately when the release cannot be resolved', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-update-release-'));
  await writeConfig(
    getConfigPath(loreHome),
    { base_url: 'https://core.example', api_token: 'lm_x' },
    { tokenAction: 'set', writeVersion: true, releaseVersion: 'v1.3.18' },
  );
  await fs.mkdir(path.join(loreHome, 'hermes', 'lore_memory'), { recursive: true });
  const { lines, log } = silentLog();

  const exit = await runUpdate(parseArgv(['update', '--channels', 'hermes']), {
    isTTY: false,
    env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
    log,
    fetchImpl: async () => { throw new Error('offline'); },
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
  });

  assert.equal(exit, 1);
  assert.ok(!lines.some((line) => line.startsWith('ok:') && /complete|完成/i.test(line)));
  assert.equal((await readConfig(getConfigPath(loreHome))).installed_version, 'v1.3.18');
});

test('failed selected channel prevents global version advancement', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-version-gate-'));
  await writeConfig(
    getConfigPath(loreHome),
    { base_url: 'https://core.example', api_token: 'lm_x' },
    { tokenAction: 'set', writeVersion: true, releaseVersion: 'v1.3.18' },
  );
  const bin = path.join(loreHome, 'bin');
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(bin, 'pi'), '#!/bin/bash\nexit 0\n');
  await fs.chmod(path.join(bin, 'pi'), 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath ?? ''}`;
  try {
    const exit = await runInstall(
      parseArgv([
        'install', '--base-url', 'https://core.example', '--api-token', 'lm_x',
        '--channels', 'hermes,pi', '--skip-docker',
      ]),
      {
        isTTY: false,
        env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
        fetchImpl: async (input) => {
          if (String(input).endsWith('/releases/latest')) {
            return new Response(null, { status: 302, headers: { location: 'https://github.com/FFatTiger/lore/releases/tag/v1.3.19' } });
          }
          return new Response('ok', { status: 200 });
        },
        run: async (argv) => {
          if (argv[0] === 'curl') return { code: 22, stdout: '', stderr: 'download failed' };
          return { code: 0, stdout: '', stderr: '' };
        },
      },
    );
    assert.equal(exit, 1);
    assert.equal((await readConfig(getConfigPath(loreHome))).installed_version, 'v1.3.18');
  } finally {
    process.env.PATH = oldPath;
  }
});

test('update with an ok and a skipped channel is incomplete', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-update-skipped-'));
  await writeConfig(
    getConfigPath(loreHome),
    { base_url: 'https://core.example', api_token: 'lm_x' },
    { tokenAction: 'set', writeVersion: true, releaseVersion: 'v1.3.18' },
  );
  await fs.mkdir(path.join(loreHome, 'hermes'), { recursive: true });
  await fs.mkdir(path.join(loreHome, 'opencode'), { recursive: true });
  const unmanagedTarget = path.join(loreHome, '.config', 'opencode', 'plugins', 'lore-memory.js');
  await fs.mkdir(path.dirname(unmanagedTarget), { recursive: true });
  await fs.writeFile(unmanagedTarget, '/* user-owned OpenCode plugin */\n');
  const { lines, log } = silentLog();

  const exit = await withPathBins(loreHome, ['opencode'], () =>
    runUpdate(parseArgv(['update', '--channels', 'hermes,opencode']), {
      isTTY: false,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
      log,
      fetchImpl: async (input) => {
        if (String(input).endsWith('/releases/latest')) {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://github.com/FFatTiger/lore/releases/tag/v1.3.19' },
          });
        }
        return new Response('ok', { status: 200 });
      },
      run: async (argv) => {
        if (argv[0] === 'curl') {
          const output = argv[argv.indexOf('-o') + 1];
          await fs.mkdir(path.dirname(output), { recursive: true });
          await fs.writeFile(output, 'zip');
          return { code: 0, stdout: '', stderr: '' };
        }
        if (argv[0] === 'unzip') {
          const extractDir = argv[argv.indexOf('-d') + 1];
          await fs.mkdir(path.join(extractDir, 'lore_memory'), { recursive: true });
          await fs.writeFile(
            path.join(extractDir, 'lore-memory.js'),
            '// @lore-managed-opencode-plugin version=1.3.19\n',
          );
          return { code: 0, stdout: '', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    }),
  );

  assert.equal(exit, 1);
  assert.ok(lines.some((line) => line.startsWith('warn:') && /not managed by Lore/i.test(line)));
  assert.ok(!lines.some((line) => line.startsWith('ok:') && /Install complete|安装完成/.test(line)));
  assert.ok(lines.some((line) => line.startsWith('err:') && /1 ok, 0 failed, 1 skipped/i.test(line)));
  assert.equal((await readConfig(getConfigPath(loreHome))).installed_version, 'v1.3.18');
});

test('non-interactive update defaults to installed and partial channels', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-update-defaults-'));
  await writeConfig(
    getConfigPath(loreHome),
    { base_url: 'https://core.example', api_token: 'lm_x' },
    { tokenAction: 'set', writeVersion: true, releaseVersion: 'v1.3.18' },
  );
  await fs.mkdir(path.join(loreHome, 'hermes', 'lore_memory'), { recursive: true });
  await fs.mkdir(path.join(loreHome, 'pi'), { recursive: true });
  const { lines, log } = silentLog();

  const exit = await runUpdate(parseArgv(['update']), {
    isTTY: false,
    env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome, PATH: '' },
    log,
    fetchImpl: async (input) => {
      if (String(input).endsWith('/releases/latest')) {
        return new Response(null, { status: 302, headers: { location: 'https://github.com/FFatTiger/lore/releases/tag/v1.3.18' } });
      }
      return new Response('ok', { status: 200 });
    },
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
  });

  assert.equal(exit, 0);
  const sections = lines.filter((line) => line.startsWith('section:'));
  assert.deepEqual(sections, ['section:pi', 'section:hermes']);
});

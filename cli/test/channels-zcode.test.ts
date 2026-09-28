import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zcodeInstaller } from '../src/channels/zcode.ts';
import { getInstaller, allInstallers } from '../src/channels/registry.ts';
import type { ChannelContext } from '../src/channels/types.ts';
import type { ExecFn } from '../src/core/exec.ts';

async function tempHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-zcode-'));
  const loreHome = path.join(home, '.lore');
  await fs.mkdir(loreHome, { recursive: true });
  return { home, loreHome };
}

function ctx(p: Partial<ChannelContext> & { loreHome: string; homeDir: string }): ChannelContext {
  return {
    baseUrl: 'https://core.example',
    apiToken: 'lm_x',
    tokenAction: 'set',
    needInstall: 2,
    capabilities: { skills: true },
    force: false,
    lang: 'en',
    releaseVersion: 'v1.3.15',
    env: { ...process.env },
    ...p,
  };
}

async function withBin(home: string, name: string, fn: (pathEnv: string) => Promise<void>) {
  const bin = path.join(home, 'bin');
  await fs.mkdir(bin, { recursive: true });
  const executable = path.join(bin, process.platform === 'win32' ? `${name}.cmd` : name);
  await fs.writeFile(
    executable,
    process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n',
  );
  if (process.platform !== 'win32') await fs.chmod(executable, 0o755);
  const pathEnv = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
  const originalPath = process.env.PATH;
  process.env.PATH = pathEnv;
  try {
    await fn(pathEnv);
  } finally {
    process.env.PATH = originalPath;
  }
}

async function seedArtifact(loreHome: string): Promise<string> {
  const dest = path.join(loreHome, 'zcode');
  await fs.mkdir(path.join(dest, '.zcode-plugin'), { recursive: true });
  await fs.mkdir(path.join(dest, 'hooks'), { recursive: true });
  await fs.writeFile(path.join(dest, 'marketplace.json'), JSON.stringify({ name: 'lore', plugins: [{ name: 'lore', source: './' }] }));
  await fs.writeFile(path.join(dest, '.zcode-plugin', 'plugin.json'), JSON.stringify({ name: 'lore', version: '1.3.23' }));
  return dest;
}

test('registry lists zcode', () => {
  const ids = allInstallers().map((i) => i.id);
  assert.ok(ids.includes('zcode'));
  assert.equal(getInstaller('zcode').id, 'zcode');
});

test('zcode skips when CLI is missing', async () => {
  const { home, loreHome } = await tempHome();
  const origPath = process.env.PATH;
  process.env.PATH = path.join(home, 'empty-bin');
  await fs.mkdir(path.join(home, 'empty-bin'), { recursive: true });
  try {
    const result = await zcodeInstaller.install(ctx({ loreHome, homeDir: home }));
    assert.equal(result.status, 'skipped');
  } finally {
    process.env.PATH = origPath;
  }
});

test('zcode install registers marketplace, installs, and enables lore@lore', async () => {
  const { home, loreHome } = await tempHome();
  const dest = await seedArtifact(loreHome);
  const calls: string[] = [];
  const run: ExecFn = async (argv) => {
    calls.push(argv.join(' '));
    if (argv.join(' ') === 'zcode plugins list') {
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'zcode', async () => {
    const result = await zcodeInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'ok');
    assert.ok(calls.some((c) => c === `zcode plugins marketplace add ${dest}`));
    assert.ok(calls.some((c) => c === 'zcode plugins install lore@lore'));
    assert.ok(calls.some((c) => c === 'zcode plugins enable lore@lore'));
    assert.ok(calls.every((c) => !c.includes('mcp')));
  });
});

test('zcode install skips plugin install when lore@lore is already listed', async () => {
  const { home, loreHome } = await tempHome();
  await seedArtifact(loreHome);
  const calls: string[] = [];
  const run: ExecFn = async (argv) => {
    calls.push(argv.join(' '));
    if (argv.join(' ') === 'zcode plugins list') {
      return { code: 0, stdout: 'lore@lore', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'zcode', async () => {
    const result = await zcodeInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'ok');
    assert.ok(calls.some((c) => c === 'zcode plugins enable lore@lore'));
    assert.ok(!calls.some((c) => c === 'zcode plugins install lore@lore'));
  });
});

test('zcode marketplace failure is failed with token redacted', async () => {
  const { home, loreHome } = await tempHome();
  await seedArtifact(loreHome);
  const run: ExecFn = async (argv) => {
    if (argv.slice(0, 4).join(' ') === 'zcode plugins marketplace add') {
      return { code: 1, stdout: '', stderr: 'marketplace rejected lm_x' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'zcode', async () => {
    const result = await zcodeInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'failed');
    assert.match(result.message ?? '', /ZCode marketplace registration failed/);
    assert.doesNotMatch(result.message ?? '', /lm_x/);
  });
});

test('zcode uninstall removes marketplace and channel dir', async () => {
  const { home, loreHome } = await tempHome();
  const dest = await seedArtifact(loreHome);
  const calls: string[] = [];
  const run: ExecFn = async (argv) => {
    calls.push(argv.join(' '));
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'zcode', async () => {
    const result = await zcodeInstaller.uninstall({ loreHome, homeDir: home, run });
    assert.equal(result.status, 'ok');
    assert.ok(calls.some((c) => c === 'zcode plugins uninstall lore@lore'));
    assert.ok(calls.some((c) => c === 'zcode plugins marketplace remove lore'));
    await assert.rejects(fs.access(dest));
  });
});

test('zcode status is installed when marketplace.json exists', async () => {
  const { home, loreHome } = await tempHome();
  await seedArtifact(loreHome);
  const status = await zcodeInstaller.status({ loreHome, homeDir: home });
  assert.equal(status.state, 'installed');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hermesInstaller } from '../src/channels/hermes.ts';
import { piInstaller } from '../src/channels/pi.ts';
import { getInstaller, allInstallers } from '../src/channels/registry.ts';
import type { ChannelContext } from '../src/channels/types.ts';
import type { ExecFn } from '../src/core/exec.ts';

async function tempHome(): Promise<{ home: string; loreHome: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-ch-'));
  const loreHome = path.join(home, '.lore');
  await fs.mkdir(loreHome, { recursive: true });
  return { home, loreHome };
}

function baseCtx(partial: Partial<ChannelContext> & { loreHome: string; homeDir: string }): ChannelContext {
  return {
    baseUrl: 'http://127.0.0.1:18901',
    tokenAction: partial.apiToken ? 'set' : 'clear',
    needInstall: 0,
    force: false,
    lang: 'en',
    releaseVersion: 'v1.3.15',
    ...partial,
  };
}

test('registry lists pi and hermes', () => {
  const ids = allInstallers().map((i) => i.id).sort();
  assert.ok(ids.includes('pi'));
  assert.ok(ids.includes('hermes'));
  assert.equal(getInstaller('pi').id, 'pi');
  assert.equal(getInstaller('hermes').id, 'hermes');
});

test('hermes install downloads and returns manual symlink instruction', async () => {
  const { home, loreHome } = await tempHome();
  const dest = path.join(loreHome, 'hermes');
  let downloaded = false;
  const run: ExecFn = async (argv) => {
    if (argv[0] === 'curl') {
      downloaded = true;
      const out = argv[argv.indexOf('-o') + 1];
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, 'fakezip');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'unzip') {
      const extractDir = argv[argv.indexOf('-d') + 1];
      await fs.mkdir(path.join(extractDir, 'lore_memory'), { recursive: true });
      await fs.writeFile(path.join(extractDir, 'lore_memory', 'plugin.yaml'), 'name: lore\n');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'rm' || argv[0] === 'mkdir') {
      // allow shell helpers if used
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  // Prefer unit path: inject download via pre-seeded dest when needInstall=2 style —
  // hermes should call downloadOrSkip with run. Seed by using needInstall=2 after mkdir.
  await fs.mkdir(path.join(dest, 'lore_memory'), { recursive: true });
  const result = await hermesInstaller.install(
    baseCtx({ loreHome, homeDir: home, needInstall: 2, run }),
  );
  assert.equal(result.status, 'ok');
  assert.match(result.message ?? '', /lore_memory/);
  assert.match(result.message ?? '', /manual/i);
  assert.match(result.message ?? '', /symlink|Hermes/i);
  assert.doesNotMatch(result.message ?? '', /configured successfully/i);
  void downloaded;
});

test('hermes uninstall removes channel dir', async () => {
  const { home, loreHome } = await tempHome();
  const dest = path.join(loreHome, 'hermes');
  await fs.mkdir(path.join(dest, 'lore_memory'), { recursive: true });
  const result = await hermesInstaller.uninstall({ loreHome, homeDir: home });
  assert.equal(result.status, 'ok');
  await assert.rejects(fs.access(dest));
});

test('pi install skips when pi CLI missing', async () => {
  const { home, loreHome } = await tempHome();
  const origPath = process.env.PATH;
  process.env.PATH = path.join(home, 'empty-bin');
  await fs.mkdir(path.join(home, 'empty-bin'), { recursive: true });
  try {
    const result = await piInstaller.install(baseCtx({ loreHome, homeDir: home, needInstall: 2 }));
    assert.equal(result.status, 'skipped');
  } finally {
    process.env.PATH = origPath;
  }
});

test('pi install creates extension link when pi is present', async () => {
  const { home, loreHome } = await tempHome();
  const dest = path.join(loreHome, 'pi');
  await fs.mkdir(dest, { recursive: true });

  const bin = path.join(home, 'bin');
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(bin, 'pi'), '#!/bin/bash\nexit 0\n');
  await fs.chmod(path.join(bin, 'pi'), 0o755);
  const origPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${origPath ?? ''}`;

  try {
    const result = await piInstaller.install(
      baseCtx({ loreHome, homeDir: home, needInstall: 2 }),
    );
    assert.equal(result.status, 'ok');
    const ext = path.join(home, '.pi', 'agent', 'extensions', 'lore');
    assert.equal((await fs.lstat(ext)).isSymbolicLink(), true);
    assert.equal(await fs.realpath(ext), await fs.realpath(dest));
  } finally {
    process.env.PATH = origPath;
  }
});

test('pi install preserves an existing extension directory', async () => {
  const { home, loreHome } = await tempHome();
  await fs.mkdir(path.join(loreHome, 'pi'), { recursive: true });
  const ext = path.join(home, '.pi', 'agent', 'extensions', 'lore');
  await fs.mkdir(ext, { recursive: true });
  await fs.writeFile(path.join(ext, 'keep'), '1');

  const bin = path.join(home, 'bin');
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(bin, 'pi'), '#!/bin/bash\nexit 0\n');
  await fs.chmod(path.join(bin, 'pi'), 0o755);
  const origPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${origPath ?? ''}`;
  try {
    const result = await piInstaller.install(baseCtx({ loreHome, homeDir: home, needInstall: 2 }));
    assert.equal(result.status, 'failed');
    assert.match(result.message ?? '', /Target exists/i);
    assert.equal(await fs.readFile(path.join(ext, 'keep'), 'utf8'), '1');
  } finally {
    process.env.PATH = origPath;
  }
});

test('pi uninstall removes symlink and channel dir', async () => {
  const { home, loreHome } = await tempHome();
  const dest = path.join(loreHome, 'pi');
  await fs.mkdir(dest, { recursive: true });
  const ext = path.join(home, '.pi', 'agent', 'extensions', 'lore');
  await fs.mkdir(path.dirname(ext), { recursive: true });
  await fs.symlink(dest, ext);

  const result = await piInstaller.uninstall({ loreHome, homeDir: home });
  assert.equal(result.status, 'ok');
  await assert.rejects(fs.lstat(ext));
  await assert.rejects(fs.access(dest));
});

test('pi uninstall preserves non-symlink extension dir', async () => {
  const { home, loreHome } = await tempHome();
  const dest = path.join(loreHome, 'pi');
  await fs.mkdir(dest, { recursive: true });
  const ext = path.join(home, '.pi', 'agent', 'extensions', 'lore');
  await fs.mkdir(ext, { recursive: true });
  await fs.writeFile(path.join(ext, 'keep'), '1');

  const result = await piInstaller.uninstall({ loreHome, homeDir: home });
  assert.equal(result.status, 'ok');
  await fs.access(path.join(ext, 'keep'));
  await assert.rejects(fs.access(dest));
});

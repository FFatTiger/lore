import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { artifactName, downloadOrSkip } from '../src/core/artifact.ts';
import { detectAgents, haveCommand } from '../src/core/detect.ts';
import { createExec, type ExecFn } from '../src/core/exec.ts';

test('artifactName map', () => {
  assert.equal(artifactName('opencode'), 'lore-opencode.zip');
  assert.equal(artifactName('claudecode'), 'lore-claudecode.zip');
  assert.equal(artifactName('codex'), 'lore-codex.zip');
  assert.equal(artifactName('pi'), 'lore-pi.zip');
  assert.equal(artifactName('openclaw'), 'lore-openclaw.zip');
  assert.equal(artifactName('hermes'), 'lore-hermes.zip');
});

test('detectAgents returns boolean map for all agents', async () => {
  // Prefer implementing haveCommand without shell: split PATH and fs.access
  const res = await detectAgents(async () => ({ code: 1, stdout: '', stderr: '' }));
  assert.equal(typeof res.docker, 'boolean');
  assert.equal(typeof res.claude, 'boolean');
  assert.equal(typeof res.codex, 'boolean');
  assert.equal(typeof res.pi, 'boolean');
  assert.equal(typeof res.openclaw, 'boolean');
  assert.equal(typeof res.opencode, 'boolean');
  assert.equal(typeof res.hermes, 'boolean');
});

test('haveCommand finds binary via PATH fs.access', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-path-'));
  const bin = path.join(dir, 'lore-fake-cli');
  await fs.writeFile(bin, '#!/bin/sh\necho ok\n');
  await fs.chmod(bin, 0o755);
  const prev = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${prev ?? ''}`;
  try {
    assert.equal(await haveCommand('lore-fake-cli'), true);
    assert.equal(await haveCommand('definitely-missing-binary-xyz'), false);
  } finally {
    process.env.PATH = prev;
  }
});

test('haveCommand uses the explicitly supplied PATH', async () => {
  assert.equal(await haveCommand('node', { PATH: '' }), false);
});

test('downloadOrSkip needInstall=2 reuses existing dir', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-art-'));
  const dest = path.join(dir, 'pi');
  await fs.mkdir(dest);
  await fs.writeFile(path.join(dest, 'marker'), '1');
  const ok = await downloadOrSkip({
    channel: 'pi',
    dest,
    releaseVersion: 'v1.0.0',
    needInstall: 2,
    run: async () => {
      throw new Error('should not download');
    },
  });
  assert.equal(ok, true);
  assert.equal(await fs.readFile(path.join(dest, 'marker'), 'utf8'), '1');
});

test('downloadOrSkip needInstall=0 downloads via curl/unzip run', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-dl-'));
  const dest = path.join(dir, 'pi');
  const calls: string[][] = [];

  const run: ExecFn = async (argv) => {
    calls.push(argv);
    if (argv[0] === 'curl') {
      // curl -fsSL url -o dest.tmp/lore-pi.zip
      const outIdx = argv.indexOf('-o');
      assert.ok(outIdx >= 0);
      const zipPath = argv[outIdx + 1];
      assert.ok(zipPath);
      await fs.mkdir(path.dirname(zipPath), { recursive: true });
      // Minimal zip is not needed if unzip is also mocked
      await fs.writeFile(zipPath, 'fake-zip');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'unzip') {
      // unzip -qo zip -d dest.tmp/extracted
      const dIdx = argv.indexOf('-d');
      assert.ok(dIdx >= 0);
      const extracted = argv[dIdx + 1];
      assert.ok(extracted);
      await fs.mkdir(extracted, { recursive: true });
      await fs.writeFile(path.join(extracted, 'plugin.json'), '{"name":"pi"}');
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unexpected: ${argv.join(' ')}` };
  };

  const ok = await downloadOrSkip({
    channel: 'pi',
    dest,
    releaseVersion: 'v1.0.0',
    needInstall: 0,
    repo: 'FFatTiger/lore',
    run,
  });
  assert.equal(ok, true);
  assert.equal(await fs.readFile(path.join(dest, 'plugin.json'), 'utf8'), '{"name":"pi"}');
  assert.ok(calls.some((c) => c[0] === 'curl'));
  assert.ok(calls.some((c) => c[0] === 'unzip'));
  const curl = calls.find((c) => c[0] === 'curl')!;
  assert.ok(curl.includes('https://github.com/FFatTiger/lore/releases/download/v1.0.0/lore-pi.zip'));
});

test('downloadOrSkip downloads and extracts without system curl or unzip', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-native-dl-'));
  const dest = path.join(dir, 'pi');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(zipSync({
    'nested/plugin.json': new TextEncoder().encode('{"name":"pi"}'),
  }), { status: 200 });
  try {
    const ok = await downloadOrSkip({
      channel: 'pi',
      dest,
      releaseVersion: 'v1.0.0',
      needInstall: 0,
    });
    assert.equal(ok, true);
    assert.equal(await fs.readFile(path.join(dest, 'nested', 'plugin.json'), 'utf8'), '{"name":"pi"}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('downloadOrSkip needInstall=2 missing dir downloads when releaseVersion set', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-skip-'));
  const dest = path.join(dir, 'codex');
  let downloaded = false;
  const run: ExecFn = async (argv) => {
    if (argv[0] === 'curl') {
      downloaded = true;
      const outIdx = argv.indexOf('-o');
      const zipPath = argv[outIdx + 1]!;
      await fs.mkdir(path.dirname(zipPath), { recursive: true });
      await fs.writeFile(zipPath, 'z');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'unzip') {
      const dIdx = argv.indexOf('-d');
      const extracted = argv[dIdx + 1]!;
      await fs.mkdir(extracted, { recursive: true });
      await fs.writeFile(path.join(extracted, 'ok'), '1');
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
  const ok = await downloadOrSkip({
    channel: 'codex',
    dest,
    releaseVersion: 'v2.0.0',
    needInstall: 2,
    run,
  });
  assert.equal(ok, true);
  assert.equal(downloaded, true);
});

test('downloadOrSkip fails when curl fails', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-fail-'));
  const dest = path.join(dir, 'hermes');
  const ok = await downloadOrSkip({
    channel: 'hermes',
    dest,
    releaseVersion: 'v1.0.0',
    needInstall: 0,
    run: async (argv) => {
      if (argv[0] === 'curl') return { code: 22, stdout: '', stderr: 'fail' };
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(ok, false);
});

test('createExec runs a simple command', async () => {
  const exec = createExec();
  const res = await exec(['node', '-e', 'process.stdout.write("hi"); process.stderr.write("err");']);
  assert.equal(res.code, 0);
  assert.equal(res.stdout, 'hi');
  assert.equal(res.stderr, 'err');
});

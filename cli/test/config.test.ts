import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getLoreHome, getConfigPath } from '../src/core/paths.ts';
import { readConfig, writeConfig } from '../src/core/config.ts';
import { writeJsonAtomic } from '../src/core/fs.ts';

test('getLoreHome respects LORE_HOME', () => {
  assert.equal(getLoreHome({ LORE_HOME: '/tmp/custom-lore' } as NodeJS.ProcessEnv), '/tmp/custom-lore');
});

test('writeConfig merges token and version', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-cli-'));
  const cfgPath = getConfigPath(dir);
  await writeConfig(cfgPath, { base_url: 'http://127.0.0.1:18901', api_token: 'lm_x' }, {
    tokenAction: 'set',
    writeVersion: true,
    releaseVersion: 'v1.2.3',
    dockerManaged: false,
  });
  const cfg = await readConfig(cfgPath);
  assert.equal(cfg.base_url, 'http://127.0.0.1:18901');
  assert.equal(cfg.api_token, 'lm_x');
  assert.equal(cfg.installed_version, 'v1.2.3');
  assert.equal(cfg.docker_managed, false);
});

test('writeConfig without writeVersion leaves installed_version intact', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-cli-'));
  const cfgPath = getConfigPath(dir);
  await writeConfig(cfgPath, { base_url: 'http://a' }, {
    writeVersion: true,
    releaseVersion: 'v1.0.0',
  });
  await writeConfig(cfgPath, { base_url: 'http://b' }, { writeVersion: false });
  const cfg = await readConfig(cfgPath);
  assert.equal(cfg.base_url, 'http://b');
  assert.equal(cfg.installed_version, 'v1.0.0');
});

test('writeConfig clear removes a saved token', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-cli-'));
  const cfgPath = getConfigPath(dir);
  await writeConfig(cfgPath, { base_url: 'https://a.example', api_token: 'lm_old' }, {
    tokenAction: 'set',
  });
  await writeConfig(cfgPath, { base_url: 'https://b.example' }, { tokenAction: 'clear' });
  const cfg = await readConfig(cfgPath);
  assert.equal(cfg.api_token, undefined);
});

test('writeConfig set rejects a missing or blank token without changing the file', async () => {
  for (const apiToken of [undefined, '   ']) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-cli-'));
    const cfgPath = getConfigPath(dir);
    await writeConfig(cfgPath, { base_url: 'https://a.example', api_token: 'lm_old' }, {
      tokenAction: 'set',
    });
    const before = await fs.readFile(cfgPath, 'utf8');

    await assert.rejects(
      writeConfig(cfgPath, { base_url: 'https://b.example', api_token: apiToken }, {
        tokenAction: 'set',
      }),
      /token.*required|requires.*token/i,
    );

    assert.equal(await fs.readFile(cfgPath, 'utf8'), before);
  }
});

test('Lore config is written with mode 0600', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-cli-'));
  const cfgPath = getConfigPath(dir);
  await writeConfig(cfgPath, { base_url: 'https://core.example', api_token: 'lm_x' }, {
    tokenAction: 'set',
  });
  assert.equal((await fs.stat(cfgPath)).mode & 0o777, 0o600);
});

test('malformed Lore config fails instead of becoming empty config', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-cli-'));
  const cfgPath = getConfigPath(dir);
  await fs.writeFile(cfgPath, '{broken', 'utf8');
  await assert.rejects(readConfig(cfgPath), /invalid JSON/i);
  assert.equal(await fs.readFile(cfgPath, 'utf8'), '{broken');
});

test('readConfig rejects non-object JSON', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-cli-'));
  const cfgPath = getConfigPath(dir);
  await fs.writeFile(cfgPath, '[]\n', 'utf8');
  await assert.rejects(readConfig(cfgPath), /object/i);
});

test('concurrent writeJsonAtomic calls use independent staging files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-cli-'));
  const destination = path.join(dir, 'config.json');
  const originalNow = Date.now;
  Date.now = () => 123456789;
  try {
    await Promise.all([
      writeJsonAtomic(destination, { writer: 'first' }),
      writeJsonAtomic(destination, { writer: 'second' }),
    ]);
  } finally {
    Date.now = originalNow;
  }

  const data = JSON.parse(await fs.readFile(destination, 'utf8')) as { writer: string };
  assert.ok(data.writer === 'first' || data.writer === 'second');
  assert.equal((await fs.stat(destination)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(dir), ['config.json']);
});

test('writeJsonAtomic cleans temporary file when rename fails', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-cli-'));
  const destination = path.join(dir, 'occupied');
  await fs.mkdir(destination);

  await assert.rejects(writeJsonAtomic(destination, { token: 'secret' }));

  const entries = await fs.readdir(dir);
  assert.deepEqual(entries, ['occupied']);
});

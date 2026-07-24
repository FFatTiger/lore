import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createExec, runChecked } from '../src/core/exec.ts';

test('createExec resolves npm-style command shims', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-exec-'));
  const shim = path.join(dir, process.platform === 'win32' ? 'lore-shim.cmd' : 'lore-shim');
  await fs.writeFile(
    shim,
    process.platform === 'win32'
      ? '@echo off\r\necho|set /p="shim-ok"\r\nexit /b 0\r\n'
      : '#!/bin/sh\nprintf shim-ok\n',
  );
  if (process.platform !== 'win32') await fs.chmod(shim, 0o755);
  const exec = createExec();
  const result = await exec(['lore-shim'], {
    env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}` },
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'shim-ok');
});

test('runChecked throws a stage-specific error on non-zero exit', async () => {
  await assert.rejects(
    runChecked(
      async () => ({ code: 7, stdout: '', stderr: 'permission denied' }),
      'Codex marketplace registration',
      ['codex', 'plugin', 'marketplace', 'add', '/tmp/lore'],
    ),
    /Codex marketplace registration failed.*permission denied/i,
  );
});

test('runChecked redacts token text from diagnostics', async () => {
  const token = 'lm_super_secret';
  await assert.rejects(
    runChecked(
      async () => ({ code: 1, stdout: '', stderr: `bad bearer ${token}` }),
      'Claude MCP registration',
      ['claude', 'mcp', 'add'],
      undefined,
      { redact: [token] },
    ),
    (err: Error) => !err.message.includes(token) && err.message.includes('[REDACTED]'),
  );
});

test('runChecked bounds and normalizes subprocess diagnostics', async () => {
  const detail = `first\nline ${'x'.repeat(500)}`;
  await assert.rejects(
    runChecked(
      async () => ({ code: 2, stdout: '', stderr: detail }),
      'OpenClaw build',
      ['npm', 'run', 'build'],
    ),
    (err: Error) => {
      assert.doesNotMatch(err.message, /\n/);
      assert.ok(err.message.length <= 'OpenClaw build failed (exit 2): '.length + 300);
      return true;
    },
  );
});

test('runChecked sanitizes rejected subprocess errors', async () => {
  const token = 'lm_rejected_secret';
  await assert.rejects(
    runChecked(
      async () => {
        throw new Error(`spawn failed\nBearer ${token} ${'x'.repeat(500)}`);
      },
      'Codex marketplace registration',
      ['codex', 'plugin', 'marketplace', 'add', token],
      undefined,
      { redact: [token] },
    ),
    (err: Error) => {
      assert.match(err.message, /^Codex marketplace registration failed:/);
      assert.ok(err.message.includes('[REDACTED]'));
      assert.ok(!err.message.includes(token));
      assert.doesNotMatch(err.message, /\n/);
      assert.ok(err.message.length <= 'Codex marketplace registration failed: '.length + 300);
      return true;
    },
  );
});

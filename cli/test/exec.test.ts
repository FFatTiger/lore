import assert from 'node:assert/strict';
import test from 'node:test';
import { runChecked } from '../src/core/exec.ts';

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

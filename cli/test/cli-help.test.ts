import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { run } from '../src/cli.ts';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('run --help exits 0 and does not throw', async () => {
  const code = await run(['--help']);
  assert.equal(code, 0);
});

test('package version is a valid release version', () => {
  assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});

test('README documents the supported safe install contract', () => {
  assert.match(readme, /@loremem\/cli.*supported/i);
  assert.match(readme, /SaaS[\s\S]*token.*required/i);
  assert.match(readme, /LORE_CODEX_INSTALL_USER_HOOKS=1/);
  assert.match(readme, /0600/);
  assert.match(readme, /loopback/i);
  assert.match(readme, /Hermes[\s\S]*manual/i);
  assert.match(readme, /per-channel.*version marker/i);
  assert.doesNotMatch(readme, /lm_[A-Za-z0-9_-]{12,}/);
});

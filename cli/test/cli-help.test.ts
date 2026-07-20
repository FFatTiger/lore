import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from '../src/cli.ts';

test('run --help exits 0 and does not throw', async () => {
  const code = await run(['--help']);
  assert.equal(code, 0);
});

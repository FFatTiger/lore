import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRelease, resolveNeedInstall, fetchReleaseTag } from '../src/core/release.ts';

test('compareRelease same stable', () => {
  assert.equal(compareRelease('v1.3.15', 'v1.3.15'), 'same');
});

test('compareRelease upgrade', () => {
  assert.equal(compareRelease('v1.3.14', 'v1.3.15'), 'older');
});

test('compareRelease installed newer', () => {
  assert.equal(compareRelease('v1.4.0', 'v1.3.15'), 'newer');
});

test('compareRelease pre to stable is older (upgrade)', () => {
  assert.equal(compareRelease('v1.3.15-pre.4', 'v1.3.15'), 'older');
});

test('compareRelease stable to pre is downgrade', () => {
  assert.equal(compareRelease('v1.3.15', 'v1.3.15-pre.4'), 'downgrade');
});

test('resolveNeedInstall same without force => 2', () => {
  assert.equal(resolveNeedInstall({ installed: 'v1.3.15', release: 'v1.3.15', force: false }), 2);
});

test('resolveNeedInstall same with force => 0', () => {
  assert.equal(resolveNeedInstall({ installed: 'v1.3.15', release: 'v1.3.15', force: true }), 0);
});

test('fetchReleaseTag dev short-circuits', async () => {
  const res = await fetchReleaseTag({
    pre: false,
    dev: true,
    fetchImpl: async () => {
      throw new Error('network should not be called');
    },
  });
  assert.equal(res.tag, 'dev');
  assert.equal(res.needInstallHint, 0);
});

test('fetchReleaseTag latest parses tag', async () => {
  const res = await fetchReleaseTag({
    pre: false,
    dev: false,
    fetchImpl: async () =>
      new Response(JSON.stringify({ tag_name: 'v1.3.15' }), { status: 200 }),
  });
  assert.equal(res.tag, 'v1.3.15');
});

test('fetchReleaseTag network failure => needInstall 1', async () => {
  const res = await fetchReleaseTag({
    pre: false,
    dev: false,
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(res.tag, null);
  assert.equal(res.needInstallHint, 1);
});

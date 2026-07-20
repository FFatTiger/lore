import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeChannelResults } from '../src/core/result.ts';
import type { ChannelResult } from '../src/core/types.ts';

test('all ok => success exit 0', () => {
  const results: ChannelResult[] = [
    { id: 'pi', status: 'ok' },
    { id: 'hermes', status: 'ok' },
  ];
  const o = summarizeChannelResults(results);
  assert.equal(o.kind, 'success');
  assert.equal(o.exitCode, 0);
});

test('ok + skipped => success exit 0', () => {
  const o = summarizeChannelResults([
    { id: 'pi', status: 'ok' },
    { id: 'opencode', status: 'skipped' },
  ]);
  assert.equal(o.kind, 'success');
  assert.equal(o.exitCode, 0);
});

test('all failed => failed exit 1 (never success)', () => {
  const o = summarizeChannelResults([
    { id: 'pi', status: 'failed', message: 'download failed' },
    { id: 'codex', status: 'failed' },
  ]);
  assert.equal(o.kind, 'failed');
  assert.equal(o.exitCode, 1);
  assert.equal(o.ok, 0);
  assert.equal(o.failed, 2);
});

test('mix ok and failed => partial exit 1', () => {
  const o = summarizeChannelResults([
    { id: 'pi', status: 'ok' },
    { id: 'codex', status: 'failed' },
  ]);
  assert.equal(o.kind, 'partial');
  assert.equal(o.exitCode, 1);
});

test('all skipped => failed exit 1', () => {
  const o = summarizeChannelResults([
    { id: 'pi', status: 'skipped' },
    { id: 'codex', status: 'skipped' },
  ]);
  assert.equal(o.kind, 'failed');
  assert.equal(o.exitCode, 1);
});

test('empty results => failed exit 1', () => {
  const o = summarizeChannelResults([]);
  assert.equal(o.kind, 'failed');
  assert.equal(o.exitCode, 1);
});

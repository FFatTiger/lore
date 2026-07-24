import assert from 'node:assert/strict';
import test from 'node:test';
import { banner } from '../src/ui/banner.ts';

test('interactive banner renders a large ASCII logo and tagline', () => {
  const lines: string[] = [];
  banner('zh', { write: (line) => lines.push(line) });

  assert.ok(lines.length >= 7);
  assert.match(lines[0]!, /███████╗/);
  assert.ok(lines.some((line) => /为 AI Agent 提供长期记忆/.test(line)));
  assert.ok(lines.every((line) => !line.includes('\t')));
});

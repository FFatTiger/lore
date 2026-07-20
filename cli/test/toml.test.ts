import assert from 'node:assert/strict';
import test from 'node:test';
import { removeTomlSection, setTomlSectionKeys } from '../src/core/toml.ts';

test('setTomlSectionKeys creates section', () => {
  const out = setTomlSectionKeys('', '[plugins."lore@lore"]', { enabled: 'true' });
  assert.match(out, /\[plugins\."lore@lore"\]/);
  assert.match(out, /enabled = true/);
});

test('setTomlSectionKeys updates existing keys', () => {
  const input = `[plugins."lore@lore"]\nenabled = false\nname = "x"\n`;
  const out = setTomlSectionKeys(input, '[plugins."lore@lore"]', { enabled: 'true' });
  assert.match(out, /enabled = true/);
  assert.match(out, /name = "x"/);
});

test('removeTomlSection drops target table', () => {
  const input = `[a]\nx = 1\n\n[plugins."lore@lore"]\nenabled = true\n\n[b]\ny = 2\n`;
  const out = removeTomlSection(input, '[plugins."lore@lore"]');
  assert.doesNotMatch(out, /lore@lore/);
  assert.match(out, /\[a\]/);
  assert.match(out, /\[b\]/);
});

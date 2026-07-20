import assert from 'node:assert/strict';
import test from 'node:test';
import { t } from '../src/ui/i18n.ts';
import { createLogger } from '../src/ui/log.ts';
import { banner } from '../src/ui/banner.ts';

test('t returns English install complete / restart / docker skip strings', () => {
  assert.equal(t('en', 'install.complete', { version: '1.3.15' }), 'Install complete (1.3.15)');
  assert.equal(
    t('en', 'restart.next', { baseUrl: 'http://127.0.0.1:18901' }),
    'Next: restart agent runtimes, then open http://127.0.0.1:18901/setup',
  );
  assert.equal(
    t('en', 'restart.codex_hooks'),
    'Codex: open /hooks and trust Lore hooks if prompted',
  );
  assert.equal(
    t('en', 'restart.codex_plugins'),
    'Codex: if /plugins still shows Lore as installable, install it manually',
  );
  assert.equal(t('en', 'docker.skip'), 'Skipping Docker');
});

test('t returns Chinese install complete / restart / docker skip strings', () => {
  assert.equal(t('zh', 'install.complete', { version: '1.3.15' }), '安装完成（1.3.15）');
  assert.equal(
    t('zh', 'restart.next', { baseUrl: 'http://127.0.0.1:18901' }),
    '下一步：重启 Agent，然后打开 http://127.0.0.1:18901/setup',
  );
  assert.equal(t('zh', 'restart.codex_hooks'), 'Codex：打开 /hooks，按提示信任 Lore hooks');
  assert.equal(
    t('zh', 'restart.codex_plugins'),
    'Codex：如果 /plugins 仍显示 Lore 可安装，手动安装即可',
  );
  assert.equal(t('zh', 'docker.skip'), '跳过 Docker');
});

test('t falls back to key for unknown keys', () => {
  assert.equal(t('en', 'missing.key'), 'missing.key');
  assert.equal(t('zh', 'missing.key'), 'missing.key');
});

test('t leaves unresolved placeholders when vars missing', () => {
  assert.equal(t('en', 'install.complete'), 'Install complete ({version})');
});

test('createLogger writes shell glyphs for info/ok/warn/err/section', () => {
  const lines: string[] = [];
  const log = createLogger({
    write(line: string) {
      lines.push(line);
    },
  });

  log.info('hello');
  log.ok('done');
  log.warn('careful');
  log.err('fail');
  log.section('Docker');

  // Allow optional ANSI color codes around glyphs (shell parity).
  assert.match(lines[0]!, /→(?:\x1b\[[0-9;]*m)*\s*hello/);
  assert.match(lines[1]!, /✓(?:\x1b\[[0-9;]*m)*\s*done/);
  assert.match(lines[2]!, /!(?:\x1b\[[0-9;]*m)*\s*careful/);
  assert.match(lines[3]!, /✗(?:\x1b\[[0-9;]*m)*\s*fail/);
  assert.equal(lines[4], '');
  assert.match(lines[5]!, /──\s*Docker/);
});

test('banner prints LORE art and language tagline', () => {
  const lines: string[] = [];
  const write = (line: string) => lines.push(line);

  banner('en', { write });
  const en = lines.join('\n');
  assert.match(en, /____/);
  assert.match(en, /long-term memory for AI agents/);
  assert.match(en, /One install script, all agent runtimes/);

  lines.length = 0;
  banner('zh', { write });
  const zh = lines.join('\n');
  assert.match(zh, /____/);
  assert.match(zh, /AI Agent 长期记忆/);
  assert.match(zh, /一条安装脚本，接入所有 Agent 运行时/);
});

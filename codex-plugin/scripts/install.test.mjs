import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const pluginRoot = path.resolve(import.meta.dirname, '..');
const installScript = path.join(pluginRoot, 'scripts', 'install.sh');

test('install defaults to plugin hooks and removes legacy Lore user hooks', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lore-codex-install-'));
  const codexHome = path.join(root, 'codex-home');
  const staleVersionRoot = path.join(codexHome, 'plugins', 'cache', 'lore', 'lore', '1.3.11');
  const fakeBin = path.join(root, 'bin');
  const fakeCodex = path.join(fakeBin, 'codex');
  execFileSync('mkdir', ['-p', codexHome, fakeBin]);
  mkdirSync(staleVersionRoot, { recursive: true });
  writeFileSync(path.join(staleVersionRoot, 'stale.txt'), 'stale version cache');
  writeFileSync(fakeCodex, '#!/usr/bin/env bash\nset -euo pipefail\necho "$@" >> "$CODEX_FAKE_LOG"\n');
  chmodSync(fakeCodex, 0o755);
  writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify({
    hooks: {
      UserPromptSubmit: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: 'LORE_CODEX_PLUGIN_ROOT="/tmp/old" npx tsx "/tmp/old/hooks/recall-inject.ts"',
              timeout: 10,
            },
          ],
        },
        {
          matcher: '',
          hooks: [{ type: 'command', command: 'echo keep-me', timeout: 1 }],
        },
      ],
      SessionStart: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: 'LORE_CODEX_PLUGIN_ROOT="/tmp/old" npx tsx "/tmp/old/hooks/rules-inject.ts"',
              timeout: 10,
            },
          ],
        },
      ],
    },
  }, null, 2));

  execFileSync('bash', [installScript], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_FAKE_LOG: path.join(root, 'codex.log'),
      PATH: `${fakeBin}:${process.env.PATH}`,
      LORE_BASE_URL: 'http://core.local',
      LORE_API_TOKEN: 'test-token',
      LORE_SKILLS_ENABLED: '1',
    },
    stdio: 'pipe',
  });

  const installedHooksPath = path.join(codexHome, 'plugins', 'cache', 'lore', 'lore', 'local', 'hooks', 'hooks.json');
  assert.equal(existsSync(installedHooksPath), true);
  const installedHooks = JSON.parse(readFileSync(installedHooksPath, 'utf8'));
  assert.match(JSON.stringify(installedHooks), /node /);
  assert.match(JSON.stringify(installedHooks), /recall-inject\.mjs/);
  assert.doesNotMatch(JSON.stringify(installedHooks), /npx tsx/);
  assert.doesNotMatch(JSON.stringify(installedHooks), /__LORE_CODEX_PLUGIN_ROOT__/);
  assert.equal(installedHooks.hooks.SessionStart[0].matcher, 'startup|resume|clear');

  const installedRoot = path.join(codexHome, 'plugins', 'cache', 'lore', 'lore', 'local');
  assert.match(JSON.stringify(installedHooks), new RegExp(installedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const installedRulesHook = readFileSync(path.join(installedRoot, 'hooks', 'rules-inject.mjs'), 'utf8');
  const installedRecallHook = readFileSync(path.join(installedRoot, 'hooks', 'recall-inject.mjs'), 'utf8');
  assert.match(installedRulesHook, /\/api\/lifecycle\/event/);
  assert.match(installedRecallHook, /\/api\/lifecycle\/event/);
  assert.doesNotMatch(installedRulesHook, /\/api\/bridge\//);
  assert.doesNotMatch(installedRecallHook, /\/api\/bridge\//);
  assert.equal(existsSync(staleVersionRoot), false);
  const codexConfig = readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
  assert.match(codexConfig, /\[mcp_servers\.lore-skills\]/);
  assert.match(codexConfig, /local-skills-mcp\/src\/server\.mjs/);
  assert.match(codexConfig, /LORE_SKILLS_ENABLED = "1"/);

  const marketplaceRoot = path.join(codexHome, 'plugins', 'lore-local-marketplace', 'plugins', 'lore');
  const marketplaceHooks = readFileSync(path.join(marketplaceRoot, 'hooks', 'hooks.json'), 'utf8');
  assert.doesNotMatch(marketplaceHooks, /__LORE_CODEX_PLUGIN_ROOT__/);
  assert.match(marketplaceHooks, new RegExp(marketplaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const userHooks = JSON.parse(readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'));
  assert.deepEqual(userHooks.hooks.SessionStart, []);
  assert.equal(userHooks.hooks.UserPromptSubmit.length, 1);
  assert.equal(userHooks.hooks.UserPromptSubmit[0].hooks[0].command, 'echo keep-me');
});

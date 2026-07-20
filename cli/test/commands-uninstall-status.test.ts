import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgv } from '../src/core/args.ts';
import { runUninstall } from '../src/commands/uninstall.ts';
import { runStatus } from '../src/commands/status.ts';
import { writeConfig } from '../src/core/config.ts';
import { getConfigPath } from '../src/core/paths.ts';

test('uninstall hermes removes channel dir', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-un-'));
  await fs.mkdir(path.join(loreHome, 'hermes', 'lore_memory'), { recursive: true });
  const args = parseArgv(['uninstall', '--channels', 'hermes', '-y']);
  const code = await runUninstall(args, {
    env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
    isTTY: false,
    confirm: async () => true,
  });
  assert.equal(code, 0);
  await assert.rejects(fs.access(path.join(loreHome, 'hermes')));
});

test('status reports token as set/absent without dumping secret', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-st-'));
  await writeConfig(getConfigPath(loreHome), {
    base_url: 'http://127.0.0.1:18901',
    api_token: 'lm_secret_should_not_print',
  });
  const lines: string[] = [];
  const code = await runStatus(parseArgv(['status']), {
    env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
    log: {
      info: (m: string) => lines.push(m),
      ok: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      err: (m: string) => lines.push(m),
      section: (m: string) => lines.push(`-- ${m}`),
    },
  });
  assert.equal(code, 0);
  assert.ok(lines.some((l) => l.includes('api_token: set')));
  assert.ok(!lines.some((l) => l.includes('lm_secret_should_not_print')));
});

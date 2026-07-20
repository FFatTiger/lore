import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInstall } from '../src/commands/install.ts';
import { parseArgv } from '../src/core/args.ts';

function silentLog() {
  const lines: string[] = [];
  return {
    lines,
    log: {
      info: (m: string) => lines.push(`info:${m}`),
      ok: (m: string) => lines.push(`ok:${m}`),
      warn: (m: string) => lines.push(`warn:${m}`),
      err: (m: string) => lines.push(`err:${m}`),
      section: (m: string) => lines.push(`section:${m}`),
    },
  };
}

test('when all channel downloads fail, does not report install complete', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-fail-'));
  const { lines, log } = silentLog();
  const args = parseArgv([
    'install',
    '--base-url',
    'https://api.loremem.com',
    '--api-token',
    'lm_x',
    '--channels',
    'pi,codex',
    '--skip-docker',
  ]);

  const exit = await runInstall(args, {
    isTTY: false,
    env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
    log,
    // No release tag + curl fails
    fetchImpl: async () => {
      throw new Error('rate limited');
    },
    run: async () => ({ code: 22, stdout: '', stderr: 'curl 404' }),
  });

  assert.equal(exit, 1);
  assert.ok(lines.some((l) => l.startsWith('err:') && /failed|失败/i.test(l)));
  assert.ok(!lines.some((l) => l.startsWith('ok:') && /Install complete|安装完成/.test(l)));
});

test('when release unknown, surfaces explicit release error before channels', async () => {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-rel-'));
  const { lines, log } = silentLog();
  const exit = await runInstall(
    parseArgv([
      'install',
      '--base-url',
      'https://api.loremem.com',
      '--api-token',
      'lm_x',
      '--channels',
      'hermes',
      '--skip-docker',
    ]),
    {
      isTTY: false,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
      log,
      fetchImpl: async () => {
        throw new Error('offline');
      },
      run: async () => ({ code: 1, stdout: '', stderr: '' }),
    },
  );
  assert.equal(exit, 1);
  assert.ok(lines.some((l) => /release|GitHub|版本/i.test(l)));
});

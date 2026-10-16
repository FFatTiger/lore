import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInstall } from '../src/commands/install.ts';
import { parseArgv } from '../src/core/args.ts';

async function installWith(skills: boolean): Promise<string[]> {
  const loreHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-hint-'));
  const lines: string[] = [];
  const record = (msg: string) => { lines.push(msg); };
  const exit = await runInstall(
    parseArgv(['install', '--base-url', 'https://core.example', '--api-token', 'lm_test', '--channels', 'hermes', '--skip-docker']),
    {
      isTTY: false,
      env: { ...process.env, LORE_HOME: loreHome, HOME: loreHome },
      log: { info: record, ok: record, warn: record, err: record, section: record },
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
      artifactRun: async (argv) => {
        if (argv[0] === 'curl') {
          const out = argv[argv.indexOf('-o') + 1];
          await fs.mkdir(path.dirname(out), { recursive: true });
          await fs.writeFile(out, 'zip');
        }
        if (argv[0] === 'unzip') {
          await fs.mkdir(path.join(argv[argv.indexOf('-d') + 1], 'lore_memory'), { recursive: true });
        }
        return { code: 0, stdout: '', stderr: '' };
      },
      fetchImpl: async (url) => {
        if (String(url).includes('/api/health')) {
          return new Response(JSON.stringify({ ok: true, capabilities: { skills } }), { status: 200 });
        }
        if (String(url).includes('api.github.com')) {
          return new Response(JSON.stringify({ tag_name: 'v1.7.0' }), { status: 200 });
        }
        return new Response('ok', { status: 200 });
      },
    },
  );
  assert.equal(exit, 0);
  return lines;
}

test('install points to the skills migration prompt when the server supports skills', async () => {
  const lines = await installWith(true);
  assert.ok(lines.some((line) => line.includes('documents/skills')), lines.join('\n'));
});

test('install says nothing about skills when the server does not support them', async () => {
  const lines = await installWith(false);
  assert.ok(!lines.some((line) => line.includes('documents/skills')), lines.join('\n'));
});

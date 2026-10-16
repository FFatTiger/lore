import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInstall } from '../src/commands/install.ts';
import { parseArgv } from '../src/core/args.ts';
import type { PromptService } from '../src/ui/prompt.ts';

const NODE_BIN = path.dirname(process.execPath);

async function seedRuntimeBin(loreHome: string, command: string): Promise<string> {
  const bin = path.join(loreHome, 'minbin');
  await fs.mkdir(bin, { recursive: true });
  const exe = path.join(bin, command);
  await fs.writeFile(exe, '#!/bin/sh\nexit 0\n');
  await fs.chmod(exe, 0o755);
  return `${bin}${path.delimiter}${NODE_BIN}`;
}

async function skill(home: string, name: string): Promise<void> {
  const dir = path.join(home, '.agents', 'skills', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(dir + '/SKILL.md', `---\nname: ${name}\ndescription: x\n---\n\n# ${name}\n`);
}

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

function prompt(answer: boolean, calls: string[]): PromptService {
  return {
    async pickLanguage() { return 'en'; },
    showStatus() {},
    async pickFirstRunAction(opts?: { initial?: 'saas' | 'external' | 'docker' }) {
      return opts?.initial ?? 'saas';
    },
    async pickExistingAction() { return 'reconfigure'; },
    async askBaseUrl(defaultValue?: string) { return defaultValue ?? 'unused'; },
    async askToken() { return 'lm_saas'; },
    async pickChannels() { return ['hermes']; },
    async pickRelease() { return 'stable'; },
    async confirm() { return true; },
    async askYesNo(question: string) {
      calls.push(question);
      return answer;
    },
  };
}

async function serve(skills: boolean): Promise<{ server: Server; baseUrl: string; posts: string[] }> {
  const posts: string[] = [];
  const server = createServer(async (req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && (url.startsWith('/api/health') || url.includes('github'))) {
      if (url.includes('releases')) {
        res.writeHead(302, { location: 'https://github.com/FFatTiger/lore/releases/tag/v1.5.1' });
        res.end();
        return;
      }
      if (url.startsWith('/api/health')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ capabilities: skills ? { skills: true } : {} }));
        return;
      }
    }
    if (req.method === 'POST' && url === '/api/skills') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      posts.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).name as string);
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end('{"id":"sk"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"tag_name":"v1.5.1"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, posts };
}

const artifactRun = async (argv: string[]) => {
  if (argv[0] === 'curl') {
    const out = argv[argv.indexOf('-o') + 1];
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, 'zip');
    return { code: 0, stdout: '', stderr: '' };
  }
  if (argv[0] === 'unzip') {
    const dir = argv[argv.indexOf('-d') + 1];
    await fs.mkdir(path.join(dir, 'lore_memory'), { recursive: true });
    return { code: 0, stdout: '', stderr: '' };
  }
  return { code: 0, stdout: '', stderr: '' };
};

async function install(opts: {
  saas?: boolean;
  skills?: boolean;
  tty?: boolean;
  argv?: string[];
  answer?: boolean;
  withSkill?: boolean;
}): Promise<{ code: number; asked: string[]; posts: string[]; lines: string[] }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-sk-inst-'));
  const bin = await seedRuntimeBin(home, 'hermes');
  if (opts.withSkill !== false) await skill(home, 'grilling');
  const saas = opts.saas !== false;
  const api = await serve(opts.skills !== false);
  const asked: string[] = [];
  const { lines, log } = silentLog();
  const base = saas ? 'https://skills-install.test' : api.baseUrl;
  const argv = (opts.argv ?? []).map((token) => (token === 'PLACEHOLDER' ? base : token));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    LORE_HOME: path.join(home, '.lore'),
    PATH: bin,
    Path: bin,
  };
  if (saas) env.LORE_SAAS_BASE_URL = base;
  else delete env.LORE_SAAS_BASE_URL;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/api/skills') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string };
      apiPosts.push(body.name);
      return new Response('{"id":"sk"}', { status: 201 });
    }
    if (url.includes('/api/health') || url.endsWith('/health')) {
      return new Response(JSON.stringify({
        capabilities: opts.skills === false ? {} : { skills: true },
      }), { status: 200 });
    }
    if (url.includes('releases')) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://github.com/FFatTiger/lore/releases/tag/v1.5.1' },
      });
    }
    return new Response('ok', { status: 200 });
  };
  const apiPosts: string[] = [];
  const previousSaas = process.env.LORE_SAAS_BASE_URL;
  if (saas) process.env.LORE_SAAS_BASE_URL = base;
  else delete process.env.LORE_SAAS_BASE_URL;
  try {
    const code = await runInstall(parseArgv(argv), {
      isTTY: opts.tty !== false,
      prompt: prompt(opts.answer === true, asked),
      env,
      log,
      artifactRun,
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
      fetchImpl,
    });
    return { code, asked, posts: saas ? apiPosts : api.posts, lines };
  } finally {
    if (previousSaas === undefined) delete process.env.LORE_SAAS_BASE_URL;
    else process.env.LORE_SAAS_BASE_URL = previousSaas;
    api.server.close();
  }
}

test('interactive SaaS install asks and imports only when the answer is yes', async () => {
  const yes = await install({ answer: true });
  assert.equal(yes.code, 0);
  assert.equal(yes.asked.length, 1);
  assert.match(yes.asked[0]!, /import/i);
  assert.deepEqual(yes.posts, ['grilling']);

  const no = await install({ answer: false });
  assert.equal(no.code, 0);
  assert.equal(no.asked.length, 1);
  assert.deepEqual(no.posts, []);
});

test('--import-skills imports without asking and --skip-skills-import never asks', async () => {
  const forced = await install({
    argv: ['install', '--import-skills', '--channels', 'hermes'],
    tty: true,
    answer: false,
  });
  assert.equal(forced.code, 0, forced.lines.join('\n'));
  assert.deepEqual(forced.asked, []);
  assert.deepEqual(forced.posts, ['grilling']);

  const skipped = await install({
    argv: ['install', '--skip-skills-import'],
    tty: true,
    answer: true,
  });
  assert.equal(skipped.code, 0);
  assert.deepEqual(skipped.asked, []);
  assert.deepEqual(skipped.posts, []);
});

test('non-interactive install skips the skills step unless --import-skills is set', async () => {
  const quiet = await install({
    tty: false,
    argv: ['install', '--base-url', 'https://skills-install.test', '--api-token', 'lm_saas', '--channels', 'hermes', '-y'],
  });
  assert.equal(quiet.code, 0);
  assert.deepEqual(quiet.asked, []);
  assert.deepEqual(quiet.posts, []);

  const forced = await install({
    tty: false,
    argv: ['install', '--base-url', 'https://skills-install.test', '--api-token', 'lm_saas', '--channels', 'hermes', '-y', '--import-skills'],
  });
  assert.equal(forced.code, 0);
  assert.deepEqual(forced.posts, ['grilling']);
});

test('open-source backend never prompts or imports skills', async () => {
  const oss = await install({
    saas: false,
    skills: false,
    tty: true,
    answer: true,
    argv: ['install', '--base-url', 'PLACEHOLDER', '--api-token', 'lm_ext', '--channels', 'hermes'],
  });
  assert.equal(oss.code, 0);
  assert.deepEqual(oss.asked, []);
  assert.deepEqual(oss.posts, []);

  const externalWithSkills = await install({
    saas: false,
    skills: true,
    tty: true,
    answer: true,
    argv: ['install', '--base-url', 'PLACEHOLDER', '--api-token', 'lm_ext', '--channels', 'hermes'],
  });
  assert.equal(externalWithSkills.code, 0);
  assert.deepEqual(externalWithSkills.asked, []);
  assert.deepEqual(externalWithSkills.posts, []);
});

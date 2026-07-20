import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureDockerServer } from '../src/core/docker.ts';
import type { ExecFn } from '../src/core/exec.ts';

const DEFAULT_BASE = 'http://127.0.0.1:18901';
const COMPOSE_BODY = 'services:\n  web:\n    image: fffattiger/lore:latest\n';

function mockRun(handlers: Array<(argv: string[], opts?: { cwd?: string }) => { code: number; stdout?: string; stderr?: string } | null>): ExecFn {
  const calls: string[][] = [];
  const fn: ExecFn & { calls: string[][] } = (async (argv, opts) => {
    calls.push(argv);
    for (const h of handlers) {
      const res = h(argv, opts);
      if (res) {
        return { code: res.code, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
      }
    }
    return { code: 0, stdout: '', stderr: '' };
  }) as ExecFn & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

function dockerComposeOk(): ExecFn {
  return mockRun([
    (argv) => {
      if (argv[0] === 'docker' && argv[1] === 'version') return { code: 0 };
      if (argv[0] === 'docker' && argv[1] === 'compose' && argv[2] === 'version') return { code: 0 };
      if (argv[0] === 'docker' && argv[1] === 'compose') return { code: 0 };
      return null;
    },
  ]);
}

function composeFetch(): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes('docker-compose.yml')) {
      return new Response(COMPOSE_BODY, { status: 200 });
    }
    if (url.includes('/api/health')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
}

test('skipDocker uses explicit base and sets skipped', async () => {
  const run = mockRun([]);
  const res = await ensureDockerServer({
    loreHome: '/tmp/unused',
    skipDocker: true,
    explicitBaseUrl: 'http://example.com:9000',
    pre: false,
    dev: false,
    run,
  });
  assert.equal(res.skipped, true);
  assert.equal(res.baseUrl, 'http://example.com:9000');
  assert.equal(res.dockerManaged, null);
  assert.equal((run as ExecFn & { calls: string[][] }).calls.length, 0);
});

test('skipDocker falls back to saved base_url', async () => {
  const res = await ensureDockerServer({
    loreHome: '/tmp/unused',
    skipDocker: true,
    pre: false,
    dev: false,
    saved: { base_url: 'http://saved.example' },
    run: mockRun([]),
  });
  assert.equal(res.skipped, true);
  assert.equal(res.baseUrl, 'http://saved.example');
  assert.equal(res.dockerManaged, null);
});

test('explicitBaseUrl uses external server without compose', async () => {
  const run = mockRun([]);
  const res = await ensureDockerServer({
    loreHome: '/tmp/unused',
    skipDocker: false,
    explicitBaseUrl: 'https://lore.example/',
    pre: false,
    dev: false,
    run,
  });
  assert.equal(res.skipped, false);
  assert.equal(res.baseUrl, 'https://lore.example');
  assert.equal(res.dockerManaged, false);
  assert.equal((run as ExecFn & { calls: string[][] }).calls.length, 0);
});

test('saved base + docker_managed updates compose and keeps base', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const dockerPath = path.join(dir, 'docker');
  await fs.mkdir(dockerPath, { recursive: true });
  await fs.writeFile(
    path.join(dockerPath, '.env'),
    'WEB_PORT=18901\nLORE_FRONTEND_IMAGE=fffattiger/lore:latest\n',
    'utf8',
  );
  await fs.writeFile(path.join(dockerPath, 'docker-compose.yml'), 'old\n', 'utf8');

  const run = dockerComposeOk();
  const res = await ensureDockerServer({
    loreHome: dir,
    skipDocker: false,
    pre: false,
    dev: false,
    saved: { base_url: 'http://127.0.0.1:18901', docker_managed: true },
    run,
    fetchImpl: composeFetch(),
    healthTimeoutMs: 1000,
  });

  assert.equal(res.skipped, false);
  assert.equal(res.baseUrl, 'http://127.0.0.1:18901');
  assert.equal(res.dockerManaged, null);

  const compose = await fs.readFile(path.join(dockerPath, 'docker-compose.yml'), 'utf8');
  assert.equal(compose, COMPOSE_BODY);

  const calls = (run as ExecFn & { calls: string[][] }).calls.map((c) => c.join(' '));
  assert.ok(calls.some((c) => c.includes('compose pull') || c === 'docker compose pull'));
  assert.ok(calls.some((c) => c.includes('compose up -d') || c === 'docker compose up -d'));
});

test('saved external server does not run compose', async () => {
  const run = mockRun([]);
  const res = await ensureDockerServer({
    loreHome: '/tmp/unused',
    skipDocker: false,
    pre: false,
    dev: false,
    saved: { base_url: 'http://remote:18901', docker_managed: false },
    run,
  });
  assert.equal(res.baseUrl, 'http://remote:18901');
  assert.equal(res.dockerManaged, null);
  assert.equal(res.skipped, false);
  assert.equal((run as ExecFn & { calls: string[][] }).calls.length, 0);
});

test('fresh start writes compose/.env, ups containers, waits for health', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const run = dockerComposeOk();
  let healthHits = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('docker-compose.yml')) {
      return new Response(COMPOSE_BODY, { status: 200 });
    }
    if (url.includes('/api/health')) {
      healthHits += 1;
      return new Response('ok', { status: 200 });
    }
    return new Response('no', { status: 404 });
  };

  const res = await ensureDockerServer({
    loreHome: dir,
    skipDocker: false,
    pre: false,
    dev: false,
    run,
    fetchImpl,
    healthTimeoutMs: 5000,
    defaultBaseUrl: DEFAULT_BASE,
  });

  assert.equal(res.skipped, false);
  assert.equal(res.baseUrl, DEFAULT_BASE);
  assert.equal(res.dockerManaged, true);
  assert.ok(healthHits >= 1);

  const dockerPath = path.join(dir, 'docker');
  const compose = await fs.readFile(path.join(dockerPath, 'docker-compose.yml'), 'utf8');
  assert.equal(compose, COMPOSE_BODY);

  const envText = await fs.readFile(path.join(dockerPath, '.env'), 'utf8');
  assert.match(envText, /POSTGRES_DB=lore/);
  assert.match(envText, /WEB_PORT=18901/);
  assert.match(envText, /REDIS_URL=redis:\/\/redis:6379\/0/);
  assert.match(envText, new RegExp(`POSTGRES_DATA_DIR=${dockerPath}/data/postgres`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // latest channel: no LORE_FRONTEND_IMAGE override (compose default)
  assert.doesNotMatch(envText, /LORE_FRONTEND_IMAGE=/);

  const calls = (run as ExecFn & { calls: string[][] }).calls.map((c) => c.join(' '));
  assert.ok(calls.some((c) => c === 'docker compose up -d'));
  assert.ok(!calls.some((c) => c === 'docker compose pull'));
});

test('fresh start with --pre writes pre-latest image tag', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const res = await ensureDockerServer({
    loreHome: dir,
    skipDocker: false,
    pre: true,
    dev: false,
    run: dockerComposeOk(),
    fetchImpl: composeFetch(),
    healthTimeoutMs: 5000,
  });
  assert.equal(res.dockerManaged, true);
  const envText = await fs.readFile(path.join(dir, 'docker', '.env'), 'utf8');
  assert.match(envText, /LORE_FRONTEND_IMAGE=fffattiger\/lore:pre-latest/);
});

test('fresh start with --dev writes dev-latest image tag', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const res = await ensureDockerServer({
    loreHome: dir,
    skipDocker: false,
    pre: false,
    dev: true,
    run: dockerComposeOk(),
    fetchImpl: composeFetch(),
    healthTimeoutMs: 5000,
  });
  assert.equal(res.dockerManaged, true);
  const envText = await fs.readFile(path.join(dir, 'docker', '.env'), 'utf8');
  assert.match(envText, /LORE_FRONTEND_IMAGE=fffattiger\/lore:dev-latest/);
});

test('updateDocker rewrites LORE_FRONTEND_IMAGE for --dev', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const dockerPath = path.join(dir, 'docker');
  await fs.mkdir(dockerPath, { recursive: true });
  await fs.writeFile(
    path.join(dockerPath, '.env'),
    'WEB_PORT=18901\nLORE_FRONTEND_IMAGE=fffattiger/lore:latest\n',
    'utf8',
  );
  await fs.writeFile(path.join(dockerPath, 'docker-compose.yml'), 'old\n', 'utf8');

  await ensureDockerServer({
    loreHome: dir,
    skipDocker: false,
    pre: false,
    dev: true,
    saved: { base_url: DEFAULT_BASE, docker_managed: true },
    run: dockerComposeOk(),
    fetchImpl: composeFetch(),
    healthTimeoutMs: 1000,
  });

  const envText = await fs.readFile(path.join(dockerPath, '.env'), 'utf8');
  assert.match(envText, /LORE_FRONTEND_IMAGE=fffattiger\/lore:dev-latest/);
  assert.match(envText, /REDIS_DATA_DIR=/);
  assert.match(envText, /REDIS_URL=redis:\/\/redis:6379\/0/);
});

test('no docker available on fresh start returns empty unmanaged result', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const run: ExecFn = async () => {
    throw new Error('ENOENT docker');
  };
  const res = await ensureDockerServer({
    loreHome: dir,
    skipDocker: false,
    pre: false,
    dev: false,
    run,
    fetchImpl: composeFetch(),
  });
  assert.equal(res.skipped, false);
  assert.equal(res.dockerManaged, null);
  assert.equal(res.baseUrl, '');
});

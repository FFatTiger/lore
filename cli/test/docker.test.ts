import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureDockerServer } from '../src/core/docker.ts';
import type { ExecFn } from '../src/core/exec.ts';

const DEFAULT_BASE = 'http://127.0.0.1:18901';
const COMPOSE_BODY = 'services:\n  web:\n    image: fffattiger/lore:latest\n';

function mockRun(
  handlers: Array<
    (argv: string[], opts?: { cwd?: string }) =>
      | { code: number; stdout?: string; stderr?: string }
      | null
  >,
): ExecFn & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = (async (argv, opts) => {
    calls.push(argv);
    for (const handler of handlers) {
      const result = handler(argv, opts);
      if (result) {
        return {
          code: result.code,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
        };
      }
    }
    return { code: 0, stdout: '', stderr: '' };
  }) as ExecFn & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

function dockerComposeOk(): ExecFn & { calls: string[][] } {
  return mockRun([
    (argv) => {
      if (argv.join(' ') === 'docker version') return { code: 0 };
      if (argv.join(' ') === 'docker compose version') return { code: 0 };
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

test('external mode uses explicit base without compose', async () => {
  const run = mockRun([]);
  const result = await ensureDockerServer({
    loreHome: '/tmp/unused',
    connectionMode: 'external',
    skipDocker: true,
    explicitBaseUrl: 'https://lore.example/',
    pre: false,
    dev: false,
    run,
  });
  assert.deepEqual(result, {
    ok: true,
    baseUrl: 'https://lore.example',
    dockerManaged: false,
    skipped: true,
  });
  assert.equal(run.calls.length, 0);
});

test('preserve with skipDocker uses saved base', async () => {
  const result = await ensureDockerServer({
    loreHome: '/tmp/unused',
    connectionMode: 'preserve',
    skipDocker: true,
    pre: false,
    dev: false,
    saved: { base_url: 'http://saved.example' },
    run: mockRun([]),
  });
  assert.deepEqual(result, {
    ok: true,
    baseUrl: 'http://saved.example',
    dockerManaged: null,
    skipped: true,
  });
});

test('preserve saved external server does not run compose', async () => {
  const run = mockRun([]);
  const result = await ensureDockerServer({
    loreHome: '/tmp/unused',
    connectionMode: 'preserve',
    skipDocker: false,
    pre: false,
    dev: false,
    saved: { base_url: 'http://remote:18901', docker_managed: false },
    run,
  });
  assert.deepEqual(result, {
    ok: true,
    baseUrl: 'http://remote:18901',
    dockerManaged: null,
    skipped: false,
  });
  assert.equal(run.calls.length, 0);
});

test('saved managed Docker updates compose, waits for health, and keeps base', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const dockerPath = path.join(dir, 'docker');
  const envPath = path.join(dockerPath, '.env');
  await fs.mkdir(dockerPath, { recursive: true });
  await fs.writeFile(
    envPath,
    'WEB_PORT=18901\nLORE_FRONTEND_IMAGE=fffattiger/lore:latest\n',
    { encoding: 'utf8', mode: 0o644 },
  );
  await fs.writeFile(path.join(dockerPath, 'docker-compose.yml'), 'old\n', 'utf8');

  const run = dockerComposeOk();
  const result = await ensureDockerServer({
    loreHome: dir,
    connectionMode: 'preserve',
    skipDocker: false,
    pre: false,
    dev: false,
    saved: { base_url: DEFAULT_BASE, docker_managed: true },
    run,
    fetchImpl: composeFetch(),
    healthTimeoutMs: 1000,
  });

  assert.deepEqual(result, {
    ok: true,
    baseUrl: DEFAULT_BASE,
    dockerManaged: null,
    skipped: false,
  });
  assert.equal(await fs.readFile(path.join(dockerPath, 'docker-compose.yml'), 'utf8'), COMPOSE_BODY);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(envPath)).mode & 0o777, 0o600);
  }
  assert.match(await fs.readFile(envPath, 'utf8'), /REDIS_DATA_DIR=/);
  const calls = run.calls.map((call) => call.join(' '));
  assert.ok(calls.includes('docker compose pull'));
  assert.ok(calls.includes('docker compose up -d'));
});

test('fresh Docker start writes secure compose env and waits for health', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const run = dockerComposeOk();
  let healthHits = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('docker-compose.yml')) return new Response(COMPOSE_BODY, { status: 200 });
    if (url.includes('/api/health')) {
      healthHits += 1;
      return new Response('ok', { status: 200 });
    }
    return new Response('no', { status: 404 });
  };

  const result = await ensureDockerServer({
    loreHome: dir,
    connectionMode: 'docker',
    skipDocker: false,
    pre: false,
    dev: false,
    run,
    fetchImpl,
    healthTimeoutMs: 5000,
    defaultBaseUrl: DEFAULT_BASE,
  });

  assert.deepEqual(result, {
    ok: true,
    baseUrl: DEFAULT_BASE,
    dockerManaged: true,
    skipped: false,
  });
  assert.ok(healthHits >= 1);
  const dockerPath = path.join(dir, 'docker');
  const envPath = path.join(dockerPath, '.env');
  const envText = await fs.readFile(envPath, 'utf8');
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(envPath)).mode & 0o777, 0o600);
  }
  assert.match(envText, /POSTGRES_DB=lore/);
  assert.match(envText, /WEB_PORT=18901/);
  assert.match(envText, /REDIS_URL=redis:\/\/redis:6379\/0/);
  assert.doesNotMatch(envText, /LORE_FRONTEND_IMAGE=/);
  assert.ok(run.calls.some((call) => call.join(' ') === 'docker compose up -d'));
  assert.ok(!run.calls.some((call) => call.join(' ') === 'docker compose pull'));
});

test('fresh Docker start writes pre-latest image tag', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const result = await ensureDockerServer({
    loreHome: dir,
    connectionMode: 'docker',
    skipDocker: false,
    pre: true,
    dev: false,
    run: dockerComposeOk(),
    fetchImpl: composeFetch(),
    healthTimeoutMs: 1000,
  });
  assert.equal(result.ok, true);
  assert.match(
    await fs.readFile(path.join(dir, 'docker', '.env'), 'utf8'),
    /LORE_FRONTEND_IMAGE=fffattiger\/lore:pre-latest/,
  );
});

test('fresh Docker start writes dev-latest image tag', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const result = await ensureDockerServer({
    loreHome: dir,
    connectionMode: 'docker',
    skipDocker: false,
    pre: false,
    dev: true,
    run: dockerComposeOk(),
    fetchImpl: composeFetch(),
    healthTimeoutMs: 1000,
  });
  assert.equal(result.ok, true);
  assert.match(
    await fs.readFile(path.join(dir, 'docker', '.env'), 'utf8'),
    /LORE_FRONTEND_IMAGE=fffattiger\/lore:dev-latest/,
  );
});

test('managed update rewrites image tag and secures an existing env', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const dockerPath = path.join(dir, 'docker');
  const envPath = path.join(dockerPath, '.env');
  await fs.mkdir(dockerPath, { recursive: true });
  await fs.writeFile(
    envPath,
    'WEB_PORT=18901\nLORE_FRONTEND_IMAGE=fffattiger/lore:latest\n',
    { encoding: 'utf8', mode: 0o644 },
  );

  const result = await ensureDockerServer({
    loreHome: dir,
    connectionMode: 'preserve',
    skipDocker: false,
    pre: false,
    dev: true,
    saved: { base_url: DEFAULT_BASE, docker_managed: true },
    run: dockerComposeOk(),
    fetchImpl: composeFetch(),
    healthTimeoutMs: 1000,
  });

  assert.equal(result.ok, true);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(envPath)).mode & 0o777, 0o600);
  }
  const envText = await fs.readFile(envPath, 'utf8');
  assert.match(envText, /LORE_FRONTEND_IMAGE=fffattiger\/lore:dev-latest/);
  assert.match(envText, /REDIS_DATA_DIR=/);
  assert.match(envText, /REDIS_URL=redis:\/\/redis:6379\/0/);
});

test('explicit Docker selection fails when Docker is unavailable', async () => {
  const result = await ensureDockerServer({
    loreHome: await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-')),
    connectionMode: 'docker',
    skipDocker: false,
    pre: false,
    dev: false,
    run: async () => {
      throw new Error('ENOENT docker');
    },
    fetchImpl: composeFetch(),
  });
  assert.deepEqual(result, { ok: false, error: 'Docker is not available' });
});

test('explicit Docker selection fails when Compose is unavailable', async () => {
  const result = await ensureDockerServer({
    loreHome: await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-')),
    connectionMode: 'docker',
    skipDocker: false,
    pre: false,
    dev: false,
    run: mockRun([
      (argv) => (argv.join(' ') === 'docker version' ? { code: 0 } : { code: 1 }),
    ]),
    fetchImpl: composeFetch(),
  });
  assert.deepEqual(result, { ok: false, error: 'Docker Compose is not available' });
});

test('explicit Docker selection fails when compose download fails', async () => {
  const result = await ensureDockerServer({
    loreHome: await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-')),
    connectionMode: 'docker',
    skipDocker: false,
    pre: false,
    dev: false,
    run: dockerComposeOk(),
    fetchImpl: async () => new Response('no', { status: 503 }),
  });
  assert.deepEqual(result, { ok: false, error: 'Could not download docker-compose.yml' });
});

test('explicit Docker selection reports compose up failure', async () => {
  const run = mockRun([
    (argv) => {
      if (argv.join(' ') === 'docker version') return { code: 0 };
      if (argv.join(' ') === 'docker compose version') return { code: 0 };
      if (argv.join(' ') === 'docker compose up -d') {
        return { code: 17, stderr: 'daemon unavailable' };
      }
      return null;
    },
  ]);
  const result = await ensureDockerServer({
    loreHome: await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-')),
    connectionMode: 'docker',
    skipDocker: false,
    pre: false,
    dev: false,
    run,
    fetchImpl: composeFetch(),
  });
  assert.deepEqual(result, { ok: false, error: 'docker compose up failed: daemon unavailable' });
});

test('explicit Docker selection reports health timeout', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('docker-compose.yml')) return new Response(COMPOSE_BODY, { status: 200 });
    return new Response('not ready', { status: 503 });
  };
  const result = await ensureDockerServer({
    loreHome: await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-')),
    connectionMode: 'docker',
    skipDocker: false,
    pre: false,
    dev: false,
    run: dockerComposeOk(),
    fetchImpl,
    healthTimeoutMs: 10,
    healthPollMs: 1,
  });
  assert.deepEqual(result, {
    ok: false,
    error: `Lore Docker health check timed out for ${DEFAULT_BASE}`,
  });
});

test('managed Docker update reports compose pull failure', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const dockerPath = path.join(dir, 'docker');
  await fs.mkdir(dockerPath, { recursive: true });
  await fs.writeFile(path.join(dockerPath, '.env'), 'WEB_PORT=18901\n', 'utf8');
  const run = mockRun([
    (argv) => {
      if (argv.join(' ') === 'docker version') return { code: 0 };
      if (argv.join(' ') === 'docker compose version') return { code: 0 };
      if (argv.join(' ') === 'docker compose pull') {
        return { code: 9, stderr: 'registry denied' };
      }
      return null;
    },
  ]);
  const result = await ensureDockerServer({
    loreHome: dir,
    connectionMode: 'preserve',
    skipDocker: false,
    pre: false,
    dev: false,
    saved: { base_url: DEFAULT_BASE, docker_managed: true },
    run,
    fetchImpl: composeFetch(),
  });
  assert.deepEqual(result, { ok: false, error: 'docker compose pull failed: registry denied' });
});

test('managed Docker update fails when its env cannot be read securely', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-'));
  const dockerPath = path.join(dir, 'docker');
  const envPath = path.join(dockerPath, '.env');
  await fs.mkdir(envPath, { recursive: true });

  const result = await ensureDockerServer({
    loreHome: dir,
    connectionMode: 'preserve',
    skipDocker: false,
    pre: false,
    dev: false,
    saved: { base_url: DEFAULT_BASE, docker_managed: true },
    run: dockerComposeOk(),
    fetchImpl: composeFetch(),
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Docker environment update failed/i);
});

test('explicit Docker reconfigure ignores a saved external URL', async () => {
  const result = await ensureDockerServer({
    loreHome: await fs.mkdtemp(path.join(os.tmpdir(), 'lore-docker-')),
    connectionMode: 'docker',
    skipDocker: false,
    pre: false,
    dev: false,
    saved: { base_url: 'https://api.loremem.com', docker_managed: false },
    run: dockerComposeOk(),
    fetchImpl: composeFetch(),
    healthTimeoutMs: 100,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.baseUrl, DEFAULT_BASE);
});

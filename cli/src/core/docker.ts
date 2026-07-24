import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ConnectionMode, LoreConfig } from './types.js';
import type { ExecFn } from './exec.js';
import { dockerDir } from './paths.js';
import { ensureDir } from './fs.js';
import { normalizeBaseUrl } from './connection.js';

export type DockerResult =
  | { ok: true; baseUrl: string; dockerManaged: boolean | null; skipped: boolean }
  | { ok: false; error: string };

const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';
const DEFAULT_REPO = 'FFatTiger/lore';
const REPO_RAW = `https://raw.githubusercontent.com/${DEFAULT_REPO}/main`;
const COMPOSE_URL = `${REPO_RAW}/docker-compose.yml`;
const IMAGE_PREFIX = 'fffattiger/lore';

export type EnsureDockerServerOpts = {
  loreHome: string;
  connectionMode: ConnectionMode;
  explicitBaseUrl?: string;
  skipDocker: boolean;
  pre: boolean;
  dev: boolean;
  saved?: LoreConfig;
  defaultBaseUrl?: string;
  run: ExecFn;
  fetchImpl?: typeof fetch;
  healthTimeoutMs?: number;
  /** Test-only: override sleep between health polls (ms). Default 3000. */
  healthPollMs?: number;
};

function success(
  baseUrl: string,
  dockerManaged: boolean | null,
  skipped: boolean,
): DockerResult {
  return { ok: true, baseUrl, dockerManaged, skipped };
}

function commandDetail(result: { stdout: string; stderr: string }): string {
  return [result.stderr, result.stdout]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function commandFailure(stage: string, result: { stdout: string; stderr: string }): DockerResult {
  const detail = commandDetail(result);
  return { ok: false, error: `${stage} failed${detail ? `: ${detail}` : ''}` };
}

function imageTag(pre: boolean, dev: boolean): string {
  if (dev) return 'dev-latest';
  if (pre) return 'pre-latest';
  return 'latest';
}

async function commandAvailable(run: ExecFn, argv: string[]): Promise<boolean> {
  try {
    const res = await run(argv, { quiet: true });
    return res.code === 0;
  } catch {
    return false;
  }
}

/** Detect docker compose variant: plugin (`docker compose`) or standalone (`docker-compose`). */
async function resolveComposeCmd(run: ExecFn): Promise<string[] | null> {
  if (await commandAvailable(run, ['docker', 'compose', 'version'])) {
    return ['docker', 'compose'];
  }
  if (await commandAvailable(run, ['docker-compose', 'version'])) {
    return ['docker-compose'];
  }
  if (await commandAvailable(run, ['docker-compose', '--version'])) {
    return ['docker-compose'];
  }
  return null;
}

async function haveDocker(run: ExecFn): Promise<boolean> {
  return commandAvailable(run, ['docker', 'version']);
}

async function downloadComposeFile(destDir: string, fetchFn: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchFn(COMPOSE_URL);
    if (!res.ok) return false;
    const body = await res.text();
    await ensureDir(destDir);
    const target = path.join(destDir, 'docker-compose.yml');
    try {
      await fs.access(target);
      const stamp = new Date()
        .toISOString()
        .replace(/[-:TZ.]/g, '')
        .slice(0, 14);
      await fs.copyFile(target, `${target}.bak.${stamp}`);
    } catch {
      // no existing file
    }
    await fs.writeFile(target, body, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function parseEnvLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function envKeySet(lines: string[]): Set<string> {
  const keys = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) keys.add(trimmed.slice(0, eq));
  }
  return keys;
}

async function updateEnvTag(envPath: string, tag: string, dockerPath: string): Promise<void> {
  let text = '';
  try {
    text = await fs.readFile(envPath, 'utf8');
  } catch {
    return;
  }
  const lines = parseEnvLines(text);
  const out: string[] = [];
  let found = false;
  for (const line of lines) {
    if (line.startsWith('LORE_FRONTEND_IMAGE=')) {
      out.push(`LORE_FRONTEND_IMAGE=${IMAGE_PREFIX}:${tag}`);
      found = true;
    } else {
      out.push(line);
    }
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  if (!found) out.push(`LORE_FRONTEND_IMAGE=${IMAGE_PREFIX}:${tag}`);
  const keys = envKeySet(out);
  if (!keys.has('REDIS_DATA_DIR')) out.push(`REDIS_DATA_DIR=${dockerPath}/data/redis`);
  if (!keys.has('REDIS_URL')) out.push('REDIS_URL=redis://redis:6379/0');
  await fs.writeFile(envPath, `${out.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(envPath, 0o600);
}

async function writeFreshEnv(
  envPath: string,
  dockerPath: string,
  pre: boolean,
  dev: boolean,
): Promise<void> {
  const pgPass = crypto.randomBytes(16).toString('hex');
  const lines = [
    'TZ=Asia/Shanghai',
    'POSTGRES_DB=lore',
    'POSTGRES_USER=lore',
    `POSTGRES_PASSWORD=${pgPass}`,
    'POSTGRES_PORT=55439',
    'WEB_PORT=18901',
    `POSTGRES_DATA_DIR=${dockerPath}/data/postgres`,
    `SNAPSHOT_DATA_DIR=${dockerPath}/data/snapshots`,
    `REDIS_DATA_DIR=${dockerPath}/data/redis`,
    'REDIS_URL=redis://redis:6379/0',
    `DATABASE_URL=postgresql://lore:${pgPass}@postgres:5432/lore`,
  ];
  if (dev) lines.push(`LORE_FRONTEND_IMAGE=${IMAGE_PREFIX}:dev-latest`);
  else if (pre) lines.push(`LORE_FRONTEND_IMAGE=${IMAGE_PREFIX}:pre-latest`);
  await fs.writeFile(envPath, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(envPath, 0o600);
}

async function waitForHealth(
  baseUrl: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetchFn(`${baseUrl}/api/health`);
      if (res.ok) return true;
    } catch {
      // retry
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
  }
  return false;
}

async function dockerPrerequisites(run: ExecFn): Promise<
  | { ok: true; composeCmd: string[] }
  | { ok: false; error: string }
> {
  if (!(await haveDocker(run))) return { ok: false, error: 'Docker is not available' };
  const composeCmd = await resolveComposeCmd(run);
  if (!composeCmd) return { ok: false, error: 'Docker Compose is not available' };
  return { ok: true, composeCmd };
}

async function updateDocker(opts: {
  loreHome: string;
  baseUrl: string;
  pre: boolean;
  dev: boolean;
  run: ExecFn;
  fetchFn: typeof fetch;
  healthTimeoutMs: number;
  healthPollMs: number;
}): Promise<DockerResult> {
  const prereq = await dockerPrerequisites(opts.run);
  if (!prereq.ok) return prereq;

  const dockerPath = dockerDir(opts.loreHome);
  if (!(await downloadComposeFile(dockerPath, opts.fetchFn))) {
    return { ok: false, error: 'Could not download docker-compose.yml' };
  }

  const envPath = path.join(dockerPath, '.env');
  try {
    await fs.access(envPath);
    await updateEnvTag(envPath, imageTag(opts.pre, opts.dev), dockerPath);
  } catch {
    // Existing managed installs created by older versions may not have an env file.
  }

  const pull = await opts.run([...prereq.composeCmd, 'pull'], { cwd: dockerPath });
  if (pull.code !== 0) return commandFailure('docker compose pull', pull);
  const up = await opts.run([...prereq.composeCmd, 'up', '-d'], { cwd: dockerPath });
  if (up.code !== 0) return commandFailure('docker compose up', up);
  if (!(await waitForHealth(opts.baseUrl, opts.fetchFn, opts.healthTimeoutMs, opts.healthPollMs))) {
    return { ok: false, error: `Lore Docker health check timed out for ${opts.baseUrl}` };
  }
  return success(opts.baseUrl, null, false);
}

async function startFreshDocker(opts: {
  loreHome: string;
  pre: boolean;
  dev: boolean;
  run: ExecFn;
  fetchFn: typeof fetch;
  defaultBaseUrl: string;
  healthTimeoutMs: number;
  healthPollMs: number;
}): Promise<DockerResult> {
  const prereq = await dockerPrerequisites(opts.run);
  if (!prereq.ok) return prereq;

  const dockerPath = dockerDir(opts.loreHome);
  await ensureDir(dockerPath);
  if (!(await downloadComposeFile(dockerPath, opts.fetchFn))) {
    return { ok: false, error: 'Could not download docker-compose.yml' };
  }

  const envPath = path.join(dockerPath, '.env');
  try {
    await fs.access(envPath);
    await fs.chmod(envPath, 0o600);
  } catch {
    await writeFreshEnv(envPath, dockerPath, opts.pre, opts.dev);
  }

  const up = await opts.run([...prereq.composeCmd, 'up', '-d'], { cwd: dockerPath });
  if (up.code !== 0) return commandFailure('docker compose up', up);
  if (!(await waitForHealth(opts.defaultBaseUrl, opts.fetchFn, opts.healthTimeoutMs, opts.healthPollMs))) {
    return {
      ok: false,
      error: `Lore Docker health check timed out for ${opts.defaultBaseUrl}`,
    };
  }
  return success(opts.defaultBaseUrl, true, false);
}

export async function ensureDockerServer(opts: EnsureDockerServerOpts): Promise<DockerResult> {
  const defaultBaseUrl = opts.defaultBaseUrl ?? DEFAULT_BASE_URL;
  const fetchFn = opts.fetchImpl ?? fetch;
  const healthTimeoutMs = opts.healthTimeoutMs ?? 180_000;
  const healthPollMs =
    opts.healthPollMs ?? Math.min(3000, Math.max(10, Math.floor(healthTimeoutMs / 60)));

  if (opts.connectionMode === 'external') {
    if (!opts.explicitBaseUrl) return { ok: false, error: 'External Lore server URL is required' };
    return success(normalizeBaseUrl(opts.explicitBaseUrl), false, opts.skipDocker);
  }

  if (opts.skipDocker) {
    const baseUrl = opts.saved?.base_url || opts.explicitBaseUrl;
    if (!baseUrl) return { ok: false, error: 'Saved Lore server URL is required' };
    return success(normalizeBaseUrl(baseUrl), null, true);
  }

  if (opts.connectionMode === 'preserve') {
    const savedBase = opts.saved?.base_url?.trim();
    if (!savedBase) return { ok: false, error: 'Saved Lore server URL is required' };
    const baseUrl = normalizeBaseUrl(savedBase);
    if (opts.saved?.docker_managed !== true) return success(baseUrl, null, false);
    return updateDocker({
      loreHome: opts.loreHome,
      baseUrl,
      pre: opts.pre,
      dev: opts.dev,
      run: opts.run,
      fetchFn,
      healthTimeoutMs,
      healthPollMs,
    });
  }

  return startFreshDocker({
    loreHome: opts.loreHome,
    pre: opts.pre,
    dev: opts.dev,
    run: opts.run,
    fetchFn,
    defaultBaseUrl,
    healthTimeoutMs,
    healthPollMs,
  });
}

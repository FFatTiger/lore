import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { LoreConfig } from './types.js';
import type { ExecFn } from './exec.js';
import { dockerDir } from './paths.js';
import { ensureDir } from './fs.js';

export type DockerResult = {
  baseUrl: string;
  dockerManaged: boolean | null; // null = unchanged/unknown
  skipped: boolean;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';
const DEFAULT_REPO = 'FFatTiger/lore';
const REPO_RAW = `https://raw.githubusercontent.com/${DEFAULT_REPO}/main`;
const COMPOSE_URL = `${REPO_RAW}/docker-compose.yml`;
const IMAGE_PREFIX = 'fffattiger/lore';

export type EnsureDockerServerOpts = {
  loreHome: string;
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

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
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
  if (!(await commandAvailable(run, ['docker', 'version']))) {
    // still try compose-only tools? shell requires docker first
    // but docker-compose might exist without docker plugin check path
  }
  if (await commandAvailable(run, ['docker', 'compose', 'version'])) {
    return ['docker', 'compose'];
  }
  if (await commandAvailable(run, ['docker-compose', 'version'])) {
    return ['docker-compose'];
  }
  // Some environments only have `docker-compose` without version subcommand success
  if (await commandAvailable(run, ['docker-compose', '--version'])) {
    return ['docker-compose'];
  }
  return null;
}

async function haveDocker(run: ExecFn): Promise<boolean> {
  return commandAvailable(run, ['docker', 'version']);
}

async function downloadComposeFile(
  destDir: string,
  fetchFn: typeof fetch,
): Promise<boolean> {
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
  // Drop pure trailing empty line from split so we control final newline
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  if (!found) {
    out.push(`LORE_FRONTEND_IMAGE=${IMAGE_PREFIX}:${tag}`);
  }
  const keys = envKeySet(out);
  if (!keys.has('REDIS_DATA_DIR')) {
    out.push(`REDIS_DATA_DIR=${dockerPath}/data/redis`);
  }
  if (!keys.has('REDIS_URL')) {
    out.push('REDIS_URL=redis://redis:6379/0');
  }
  const body = out.join('\n') + '\n';
  await fs.writeFile(envPath, body, 'utf8');
}

async function writeFreshEnv(envPath: string, dockerPath: string, pre: boolean, dev: boolean): Promise<void> {
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
  if (dev) {
    lines.push(`LORE_FRONTEND_IMAGE=${IMAGE_PREFIX}:dev-latest`);
  } else if (pre) {
    lines.push(`LORE_FRONTEND_IMAGE=${IMAGE_PREFIX}:pre-latest`);
  }
  await fs.writeFile(envPath, lines.join('\n') + '\n', 'utf8');
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
    await new Promise((r) => setTimeout(r, Math.min(pollMs, remaining)));
  }
  return false;
}

async function updateDocker(opts: {
  loreHome: string;
  pre: boolean;
  dev: boolean;
  run: ExecFn;
  fetchFn: typeof fetch;
}): Promise<void> {
  const dockerPath = dockerDir(opts.loreHome);
  if (!(await haveDocker(opts.run))) {
    return;
  }
  const composeCmd = await resolveComposeCmd(opts.run);
  if (!composeCmd) return;

  await downloadComposeFile(dockerPath, opts.fetchFn);

  const envPath = path.join(dockerPath, '.env');
  try {
    await fs.access(envPath);
    await updateEnvTag(envPath, imageTag(opts.pre, opts.dev), dockerPath);
  } catch {
    // no .env — shell only updates when present
  }

  await opts.run([...composeCmd, 'pull'], { cwd: dockerPath });
  await opts.run([...composeCmd, 'up', '-d'], { cwd: dockerPath });
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
  if (!(await haveDocker(opts.run))) {
    return { baseUrl: '', dockerManaged: null, skipped: false };
  }
  const composeCmd = await resolveComposeCmd(opts.run);
  if (!composeCmd) {
    return { baseUrl: '', dockerManaged: null, skipped: false };
  }

  const dockerPath = dockerDir(opts.loreHome);
  await ensureDir(dockerPath);

  const ok = await downloadComposeFile(dockerPath, opts.fetchFn);
  if (!ok) {
    return { baseUrl: '', dockerManaged: null, skipped: false };
  }

  const envPath = path.join(dockerPath, '.env');
  try {
    await fs.access(envPath);
  } catch {
    await writeFreshEnv(envPath, dockerPath, opts.pre, opts.dev);
  }

  const up = await opts.run([...composeCmd, 'up', '-d'], { cwd: dockerPath });
  if (up.code !== 0) {
    return { baseUrl: '', dockerManaged: null, skipped: false };
  }

  const baseUrl = opts.defaultBaseUrl;
  await waitForHealth(baseUrl, opts.fetchFn, opts.healthTimeoutMs, opts.healthPollMs);

  return { baseUrl, dockerManaged: true, skipped: false };
}

/**
 * Port of scripts/install.sh start_docker / update_docker.
 *
 * Behavior:
 * 1. skipDocker → explicit or saved base; skipped true
 * 2. explicitBaseUrl → external server, dockerManaged false
 * 3. saved base + docker_managed → updateDocker
 * 4. saved base without docker_managed → use saved external
 * 5. else start fresh compose under loreHome/docker
 */
export async function ensureDockerServer(opts: EnsureDockerServerOpts): Promise<DockerResult> {
  const defaultBaseUrl = opts.defaultBaseUrl ?? DEFAULT_BASE_URL;
  const fetchFn = opts.fetchImpl ?? fetch;
  // Shell: 60 attempts * 3s = 180s
  const healthTimeoutMs = opts.healthTimeoutMs ?? 180_000;
  // Cap default poll so short healthTimeoutMs (tests) still finishes quickly.
  const healthPollMs =
    opts.healthPollMs ?? Math.min(3000, Math.max(10, Math.floor(healthTimeoutMs / 60)));

  if (opts.skipDocker) {
    const base =
      (opts.explicitBaseUrl && stripTrailingSlash(opts.explicitBaseUrl)) ||
      (opts.saved?.base_url && stripTrailingSlash(opts.saved.base_url)) ||
      '';
    return { baseUrl: base, dockerManaged: null, skipped: true };
  }

  if (opts.explicitBaseUrl) {
    return {
      baseUrl: stripTrailingSlash(opts.explicitBaseUrl),
      dockerManaged: false,
      skipped: false,
    };
  }

  const savedBase = opts.saved?.base_url?.trim();
  if (savedBase) {
    const baseUrl = stripTrailingSlash(savedBase);
    if (opts.saved?.docker_managed === true) {
      await updateDocker({
        loreHome: opts.loreHome,
        pre: opts.pre,
        dev: opts.dev,
        run: opts.run,
        fetchFn,
      });
      return { baseUrl, dockerManaged: null, skipped: false };
    }
    // saved external
    return { baseUrl, dockerManaged: null, skipped: false };
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

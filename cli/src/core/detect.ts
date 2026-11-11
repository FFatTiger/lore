import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { constants as fsConstants } from 'node:fs';
import type { ExecFn } from './exec.js';
import { dshHomeDir } from './paths.js';

const AGENT_BINS = [
  'claude',
  'codex',
  'pi',
  'openclaw',
  'opencode',
  'hermes',
  'zcode',
  'dsh',
  'docker',
] as const;

export type DetectedAgents = Record<(typeof AGENT_BINS)[number], boolean>;

/**
 * Check whether `name` is an executable on PATH by scanning directories
 * with fs.access (no shell). PATH can be supplied explicitly so callers and
 * tests do not accidentally inspect the parent process environment.
 */
export async function haveCommand(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!name) return false;

  // Absolute/relative path: direct access check
  if (name.includes('/') || name.includes('\\') || path.isAbsolute(name)) {
    try {
      await fs.access(name, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const pathEnv = env.PATH ?? env.Path ?? env.path ?? '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const candidates =
    process.platform === 'win32'
      ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`]
      : [name];

  for (const dir of dirs) {
    for (const cand of candidates) {
      const full = path.join(dir, cand);
      try {
        await fs.access(full, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
        return true;
      } catch {
        // try next
      }
    }
  }
  return false;
}

/** dsh is present when its binary is on PATH or its runtime home exists. */
export async function isDshRuntimePresent(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): Promise<boolean> {
  if (await haveCommand('dsh', env)) return true;
  try {
    await fs.access(dshHomeDir(env, homeDir));
    return true;
  } catch {
    return false;
  }
}

export async function detectAgents(
  _exec?: ExecFn,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DetectedAgents> {
  const entries = await Promise.all(
    AGENT_BINS.map(async (bin) => [bin, await haveCommand(bin, env)] as const),
  );
  return Object.fromEntries(entries) as DetectedAgents;
}

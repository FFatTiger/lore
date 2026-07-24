import fs from 'node:fs/promises';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import type { ExecFn } from './exec.js';

const AGENT_BINS = [
  'claude',
  'codex',
  'pi',
  'openclaw',
  'opencode',
  'hermes',
  'docker',
] as const;

export type DetectedAgents = Record<(typeof AGENT_BINS)[number], boolean>;

/**
 * Check whether `name` is an executable on PATH by scanning directories
 * with fs.access (no shell). The optional `exec` arg is accepted for API
 * symmetry with channel helpers but is not used for PATH lookup.
 */
export async function haveCommand(
  name: string,
  _exec?: ExecFn,
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

  const pathEnv = process.env.PATH ?? '';
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

export async function detectAgents(exec?: ExecFn): Promise<DetectedAgents> {
  const entries = await Promise.all(
    AGENT_BINS.map(async (bin) => [bin, await haveCommand(bin, exec)] as const),
  );
  return Object.fromEntries(entries) as DetectedAgents;
}

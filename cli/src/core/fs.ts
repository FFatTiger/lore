import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as T;
    return data ?? fallback;
  } catch {
    return fallback;
  }
}

export async function readJsonFileStrict<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${err.message}`);
    }
    throw err;
  }
}

export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
  opts: { mode?: number } = {},
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const mode = opts.mode ?? 0o600;
  const tmp = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf8',
      mode,
    });
    await fs.chmod(tmp, mode);
    await fs.rename(tmp, filePath);
    await fs.chmod(filePath, mode);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

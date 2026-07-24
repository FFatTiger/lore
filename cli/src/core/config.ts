import path from 'node:path';
import { readJsonFileStrict, writeJsonAtomic, ensureDir } from './fs.js';
import type { LoreConfig, TokenAction } from './types.js';

export async function readConfig(configPath: string): Promise<LoreConfig> {
  const data = await readJsonFileStrict<unknown>(configPath);
  if (data === undefined) return {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Lore config in ${configPath} must be a JSON object`);
  }
  return data as LoreConfig;
}

export async function writeConfig(
  configPath: string,
  patch: { base_url: string; api_token?: string },
  opts: {
    tokenAction?: TokenAction;
    writeVersion?: boolean;
    releaseVersion?: string;
    dockerManaged?: boolean | null;
  } = {},
): Promise<LoreConfig> {
  await ensureDir(path.dirname(configPath));
  const current = await readConfig(configPath);
  const tokenAction = opts.tokenAction ?? (patch.api_token ? 'set' : 'keep');
  const token = patch.api_token?.trim();
  if (tokenAction === 'set' && !token) {
    throw new Error('Token action "set" requires a non-empty API token');
  }
  const next: LoreConfig = { ...current, base_url: patch.base_url.replace(/\/$/, '') };
  if (tokenAction === 'set') next.api_token = token;
  if (tokenAction === 'clear') delete next.api_token;
  if (opts.writeVersion && opts.releaseVersion) {
    next.installed_version = opts.releaseVersion;
  }
  if (opts.dockerManaged === true) next.docker_managed = true;
  else if (opts.dockerManaged === false) next.docker_managed = false;
  else if (next.docker_managed === undefined) next.docker_managed = false;
  await writeJsonAtomic(configPath, next, { mode: 0o600 });
  return next;
}

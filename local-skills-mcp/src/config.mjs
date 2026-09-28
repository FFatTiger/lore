import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';
const DEFAULT_TIMEOUT_MS = 30000;
const ALLOWED_CLIENT_TYPES = new Set(['codex', 'claudecode']);

function pickString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function readSharedConfig(loreHome) {
  try {
    const raw = fs.readFileSync(path.join(loreHome, 'config.json'), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function resolveLoreHome(env = process.env) {
  const fromEnv = pickString(env.LORE_HOME);
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), '.lore');
}

export function resolveClientType(argv = process.argv.slice(2), env = process.env) {
  const flagIndex = argv.findIndex((arg) => arg === '--client-type' || arg === '--client_type');
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return pickString(argv[flagIndex + 1]).toLowerCase();
  }
  const eq = argv.find((arg) => arg.startsWith('--client-type=') || arg.startsWith('--client_type='));
  if (eq) return pickString(eq.split('=').slice(1).join('=')).toLowerCase();
  return pickString(env.LORE_CLIENT_TYPE).toLowerCase() || 'codex';
}

/**
 * Resolve runtime config from env + ~/.lore/config.json.
 * Token is never required in argv; prefer env then shared config.
 */
export function loadConfig(opts = {}) {
  const env = opts.env || process.env;
  const argv = opts.argv || process.argv.slice(2);
  const loreHome = pickString(opts.loreHome) || resolveLoreHome(env);
  const shared = readSharedConfig(loreHome);
  const clientTypeRaw = resolveClientType(argv, env);
  const clientType = ALLOWED_CLIENT_TYPES.has(clientTypeRaw) ? clientTypeRaw : clientTypeRaw || 'codex';
  if (!ALLOWED_CLIENT_TYPES.has(clientType)) {
    throw new Error(`unsupported client_type for local skills MCP: ${clientType}`);
  }

  const baseUrl = (
    pickString(opts.baseUrl)
    || pickString(env.LORE_BASE_URL)
    || pickString(shared.base_url)
    || DEFAULT_BASE_URL
  ).replace(/\/+$/, '');

  const apiToken = pickString(opts.apiToken)
    || pickString(env.LORE_API_TOKEN)
    || pickString(env.API_TOKEN)
    || pickString(shared.api_token);

  const timeoutMs = Number.isFinite(opts.timeoutMs)
    ? Number(opts.timeoutMs)
    : (Number.isFinite(Number(env.LORE_TIMEOUT_MS)) ? Number(env.LORE_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS);

  return {
    loreHome: path.resolve(loreHome),
    baseUrl,
    apiToken,
    clientType,
    timeoutMs,
    env,
    skillsEnabled: env.LORE_SKILLS_ENABLED === '1',
  };
}

export { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, ALLOWED_CLIENT_TYPES };

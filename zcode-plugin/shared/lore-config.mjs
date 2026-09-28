/**
 * Shared Lore configuration for the ZCode plugin (lifecycle hooks + MCP bridge).
 *
 * The Lore home directory is ${LORE_HOME:-~/.lore}. Configuration resolution
 * order (highest precedence first):
 *   1. <lore home>/config.json: base_url / api_token
 *   2. <lore home>/config.json: server_profile.base_url / server_profile.api_token
 *   3. environment: LORE_BASE_URL / LORE_API_TOKEN / API_TOKEN
 *   4. defaults: http://127.0.0.1:18901, no token
 *
 * Parsing failures fall back to the next source; this module never throws so
 * hooks and the bridge can stay fail-open.
 *
 * Skills are fail-closed: LORE_SKILLS_ENABLED=0 turns them off, otherwise a
 * server_profile recorded by the installer for the same base URL decides, and
 * LORE_SKILLS_ENABLED=1 only applies when no matching profile exists. The
 * open-source Lore server advertises no Skills, so its users see none.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:18901';

export function pickString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function loreHomeDir(env = process.env) {
  const fromEnv = pickString(env.LORE_HOME);
  return fromEnv || path.join(os.homedir(), '.lore');
}

function readConfigObject(configPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  return {};
}

export function loadLoreConfig(env = process.env) {
  const loreHome = loreHomeDir(env);
  const file = readConfigObject(path.join(loreHome, 'config.json'));
  const profile = file.server_profile && typeof file.server_profile === 'object' && !Array.isArray(file.server_profile)
    ? file.server_profile
    : {};
  const baseUrl = pickString(file.base_url)
    || pickString(profile.base_url)
    || pickString(env.LORE_BASE_URL)
    || DEFAULT_BASE_URL;
  const apiToken = pickString(file.api_token)
    || pickString(profile.api_token)
    || pickString(env.LORE_API_TOKEN)
    || pickString(env.API_TOKEN);
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  return {
    baseUrl: normalizedBaseUrl,
    apiToken,
    loreHome,
    skillsEnabled: resolveSkillsEnabled(profile, normalizedBaseUrl, env),
  };
}

function resolveSkillsEnabled(profile, baseUrl, env) {
  if (env.LORE_SKILLS_ENABLED === '0') return false;
  if (pickString(profile.base_url).replace(/\/+$/, '').toLowerCase() === baseUrl.toLowerCase()) {
    return profile.capabilities?.skills === true;
  }
  return env.LORE_SKILLS_ENABLED === '1';
}

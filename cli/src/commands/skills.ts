import path from 'node:path';
import type { Lang } from '../core/types.js';
import { getConfigPath, getLoreHome } from '../core/paths.js';
import { readConfig } from '../core/config.js';
import { fetchServerProfile } from '../core/capabilities.js';
import {
  defaultSkillsDir,
  scanSkillsDir,
  type ScannedSkill,
  type SkillPackage,
} from '../core/skills.js';
import { createLogger, type Logger } from '../ui/log.js';
import { t } from '../ui/i18n.js';

export type SkillsImportArgs = {
  dirs: string[];
  dryRun: boolean;
  json: boolean;
  lang: Lang;
};

export type ImportItem = { name: string; reason?: string; symlinks?: string[] };

export type ImportReport = {
  imported: ImportItem[];
  skipped: ImportItem[];
  failed: ImportItem[];
  dry_run: boolean;
};

export type SkillsDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  log?: Logger;
  now?: () => string;
};

type PostResult =
  | { ok: true }
  | { ok: false; exists: boolean; detail: string };

function resolveLang(env: NodeJS.ProcessEnv): Lang {
  return env.LORE_INSTALL_LANG?.trim().toLowerCase() === 'zh' ? 'zh' : 'en';
}

export function parseSkillsArgv(argv: string[], env: NodeJS.ProcessEnv = process.env): SkillsImportArgs {
  if (argv[0] !== 'import') {
    throw new Error(`Unknown skills command: ${argv[0] ?? '(missing)'}`);
  }
  const args: SkillsImportArgs = {
    dirs: [],
    dryRun: false,
    json: false,
    lang: resolveLang(env),
  };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === '--dry-run') args.dryRun = true;
    else if (token === '--json') args.json = true;
    else if (token === '--lang') {
      const value = argv[++i];
      if (value !== 'en' && value !== 'zh') throw new Error(`Invalid lang: ${value ?? ''} (expected en|zh)`);
      args.lang = value;
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown flag: ${token}`);
    } else {
      args.dirs.push(token);
    }
  }
  if (args.dirs.length === 0) args.dirs.push(defaultSkillsDir(env));
  return args;
}

async function postSkill(
  baseUrl: string,
  apiToken: string | undefined,
  skill: SkillPackage,
  fetchImpl: typeof fetch,
): Promise<PostResult> {
  const url = new URL('/api/skills', `${baseUrl.replace(/\/+$/, '')}/`);
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: skill.name,
      enabled: skill.enabled,
      files: skill.files,
      source: skill.source,
    }),
  });
  if (response.ok) return { ok: true };
  let payload: { code?: string; detail?: string; error?: string } = {};
  try {
    payload = await response.json() as typeof payload;
  } catch {
    payload = {};
  }
  const exists = response.status === 409 && payload.code === 'skill_exists';
  const detail = payload.detail || payload.error || `HTTP ${response.status}`;
  return { ok: false, exists, detail };
}

function symlinkNote(lang: Lang, skill: SkillPackage): string | undefined {
  if (skill.symlinks.length === 0) return undefined;
  return t(lang, 'skills.symlink_skipped', { name: skill.name, paths: skill.symlinks.join(', ') });
}

function printReport(lang: Lang, report: ImportReport, log: Logger): void {
  const importedKey = report.dry_run ? 'skills.would_import' : 'skills.imported';
  const skippedKey = report.dry_run ? 'skills.would_skip' : 'skills.skipped';
  log.info(t(lang, importedKey, { count: String(report.imported.length) }));
  for (const item of report.imported) {
    log.ok(item.name);
    if (item.reason) log.warn(item.reason);
  }
  log.info(t(lang, skippedKey, { count: String(report.skipped.length) }));
  for (const item of report.skipped) log.warn(`${item.name}: ${item.reason ?? ''}`);
  if (!report.dry_run) {
    log.info(t(lang, 'skills.failed', { count: String(report.failed.length) }));
    for (const item of report.failed) log.err(`${item.name}: ${item.reason ?? ''}`);
  }
  log.info(t(lang, 'skills.local_copies'));
}

export async function importSkills(args: SkillsImportArgs, deps: SkillsDeps = {}): Promise<{ code: number; report: ImportReport }> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const log = deps.log ?? createLogger();
  const importedAt = deps.now?.() ?? new Date().toISOString();
  const loreHome = getLoreHome(env);
  const config = await readConfig(getConfigPath(loreHome));
  if (!config.base_url) {
    throw new Error(t(args.lang, 'skills.no_server'));
  }

  const profile = await fetchServerProfile({
    baseUrl: config.base_url,
    apiToken: config.api_token,
    fetchImpl,
  });
  if (profile.capabilities.skills !== true) {
    throw new Error(t(args.lang, 'skills.unsupported'));
  }

  const scanned: ScannedSkill[] = [];
  for (const dir of args.dirs) scanned.push(...await scanSkillsDir(path.resolve(dir), importedAt));

  const report: ImportReport = { imported: [], skipped: [], failed: [], dry_run: args.dryRun };
  for (const item of scanned) {
    if (item.kind === 'skip') {
      report.skipped.push(item.skip);
      continue;
    }
    const note = symlinkNote(args.lang, item.skill);
    if (args.dryRun) {
      report.imported.push({ name: item.skill.name, ...(note ? { reason: note } : {}) });
      continue;
    }
    try {
      const posted = await postSkill(config.base_url, config.api_token, item.skill, fetchImpl);
      if (posted.ok) {
        report.imported.push({
          name: item.skill.name,
          ...(note ? { reason: note } : {}),
          ...(item.skill.symlinks.length ? { symlinks: item.skill.symlinks } : {}),
        });
      } else if (posted.exists) {
        report.skipped.push({ name: item.skill.name, reason: t(args.lang, 'skills.already') });
      } else {
        report.failed.push({ name: item.skill.name, reason: posted.detail });
      }
    } catch (err) {
      report.failed.push({
        name: item.skill.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(args.lang, report, log);
  }
  return { code: report.failed.length > 0 ? 1 : 0, report };
}

export async function runSkills(argv: string[], deps: SkillsDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? createLogger();
  let args: SkillsImportArgs;
  try {
    args = parseSkillsArgv(argv, env);
  } catch (err) {
    log.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
  try {
    const result = await importSkills(args, { ...deps, env, log });
    return result.code;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (args.json) console.log(JSON.stringify({ error: message }));
    else log.err(message);
    return 1;
  }
}

import { ALL_CHANNELS, type ChannelId, type ChannelResult, type Lang, type NeedInstall } from '../core/types.js';
import type { GlobalArgs } from '../core/args.js';
import { getConfigPath, getLoreHome } from '../core/paths.js';
import { readConfig, writeConfig } from '../core/config.js';
import { ensureDockerServer } from '../core/docker.js';
import { fetchReleaseTag, resolveNeedInstall } from '../core/release.js';
import { createExec, type ExecFn } from '../core/exec.js';
import { getInstaller } from '../channels/registry.js';
import { createLogger } from '../ui/log.js';
import { banner } from '../ui/banner.js';
import { t } from '../ui/i18n.js';
import type { PromptService } from '../ui/prompt.js';

export type InstallDeps = {
  env?: NodeJS.ProcessEnv;
  run?: ExecFn;
  fetchImpl?: typeof fetch;
  isTTY?: boolean;
  prompt?: PromptService | null;
  log?: ReturnType<typeof createLogger>;
};

function resolveLang(args: GlobalArgs, env: NodeJS.ProcessEnv): Lang {
  if (args.lang) return args.lang;
  const fromEnv = env.LORE_INSTALL_LANG?.trim().toLowerCase();
  if (fromEnv === 'zh') return 'zh';
  return 'en';
}

function resolveChannels(args: GlobalArgs): ChannelId[] {
  return args.channels?.length ? args.channels : [...ALL_CHANNELS];
}

export async function runInstall(args: GlobalArgs, deps: InstallDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const run = deps.run ?? createExec();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const log = deps.log ?? createLogger();
  const lang = resolveLang(args, env);
  const loreHome = getLoreHome(env);
  const configPath = getConfigPath(loreHome);

  if (!isTTY && args.interactiveDefault) {
    console.error('Interactive install requires a TTY. Pass flags (e.g. --base-url, --channels).');
    return 2;
  }

  // Interactive fill-in (Task 15 may deepen prompts). For now only when TTY and missing fields.
  let baseUrl = args.baseUrl;
  let apiToken = args.apiToken;
  let channels = resolveChannels(args);
  let pre = args.pre;
  let dev = args.dev;
  let skipDocker = args.skipDocker;
  let explicitBaseUrl = args.explicitBaseUrl;

  if (isTTY && deps.prompt && (args.interactiveDefault || (!baseUrl && !skipDocker))) {
    banner(lang);
    if (args.interactiveDefault || !args.channels) {
      // detect defaults later — keep all if user doesn't pick
    }
    const mode = await deps.prompt.selectMode();
    if (mode === 'external') {
      baseUrl = await deps.prompt.askBaseUrl(baseUrl);
      apiToken = (await deps.prompt.askToken()) || apiToken;
      skipDocker = true;
      explicitBaseUrl = true;
    } else {
      const release = await deps.prompt.pickRelease();
      pre = release === 'pre';
      dev = release === 'dev';
    }
    channels = await deps.prompt.pickChannels(channels);
    const summary = `base=${baseUrl ?? '(docker)'} channels=${channels.join(',')} pre=${pre} dev=${dev}`;
    const ok = await deps.prompt.confirm(summary);
    if (!ok) return 1;
  }

  const saved = await readConfig(configPath);
  if (!apiToken && !args.explicitApiToken) apiToken = saved.api_token;

  const docker = await ensureDockerServer({
    loreHome,
    explicitBaseUrl: explicitBaseUrl ? baseUrl : undefined,
    skipDocker,
    pre,
    dev,
    saved,
    run,
    fetchImpl,
  });

  const resolvedBase = (docker.baseUrl || baseUrl || saved.base_url || 'http://127.0.0.1:18901').replace(
    /\/$/,
    '',
  );

  const releaseInfo = await fetchReleaseTag({ pre, dev, fetchImpl });
  let needInstall: NeedInstall = releaseInfo.needInstallHint;
  let releaseVersion = releaseInfo.tag ?? undefined;
  if (releaseVersion) {
    needInstall = resolveNeedInstall({
      installed: saved.installed_version,
      release: releaseVersion,
      force: args.force,
    });
    // network failure already set needInstallHint 1 when tag null
  } else if (releaseInfo.needInstallHint === 1) {
    needInstall = 1;
  }

  await writeConfig(
    configPath,
    { base_url: resolvedBase, api_token: apiToken },
    {
      writeVersion: false,
      dockerManaged:
        docker.dockerManaged === null
          ? undefined
          : docker.dockerManaged,
    },
  );

  log.info(`Server: ${resolvedBase}`);
  log.info(`Channels: ${channels.join(',')} (${dev ? 'dev' : pre ? 'pre-release' : 'stable'})`);

  const results: ChannelResult[] = [];
  for (const id of channels) {
    log.section(id);
    try {
      const installer = getInstaller(id);
      const result = await installer.install({
        loreHome,
        baseUrl: resolvedBase,
        apiToken,
        releaseVersion,
        needInstall,
        force: args.force,
        lang,
        run,
        homeDir: env.HOME || undefined,
      });
      results.push(result);
      if (result.status === 'ok') log.ok(result.message ?? `${id} ok`);
      else if (result.status === 'skipped') log.warn(result.message ?? `${id} skipped`);
      else log.err(result.message ?? `${id} failed`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ id, status: 'failed', message });
      log.err(`${id}: ${message}`);
    }
  }

  await writeConfig(
    configPath,
    { base_url: resolvedBase, api_token: apiToken },
    {
      writeVersion: needInstall !== 2,
      releaseVersion,
      dockerManaged:
        docker.dockerManaged === null
          ? undefined
          : docker.dockerManaged,
    },
  );

  const failed = results.filter((r) => r.status === 'failed');
  const okCount = results.filter((r) => r.status === 'ok').length;
  log.ok(t(lang, 'install.complete', { version: releaseVersion ?? 'unknown' }));
  log.info(t(lang, 'config.path', { path: configPath }));
  log.info(t(lang, 'setup.url', { baseUrl: resolvedBase }));
  log.info(t(lang, 'restart.next', { baseUrl: resolvedBase }));

  if (failed.length && okCount === 0) return 1;
  return 0;
}

export async function runUpdate(args: GlobalArgs, deps: InstallDeps = {}): Promise<number> {
  // Update is install with channels defaulting to all and config reuse.
  return runInstall({ ...args, interactiveDefault: false }, deps);
}

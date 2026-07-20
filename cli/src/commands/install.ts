import { ALL_CHANNELS, type ChannelId, type ChannelResult, type Lang, type NeedInstall } from '../core/types.js';
import type { GlobalArgs } from '../core/args.js';
import { getConfigPath, getLoreHome } from '../core/paths.js';
import { readConfig, writeConfig } from '../core/config.js';
import { ensureDockerServer } from '../core/docker.js';
import { fetchReleaseTag, resolveNeedInstall } from '../core/release.js';
import { createExec, type ExecFn } from '../core/exec.js';
import { getInstaller } from '../channels/registry.js';
import { collectInstallSnapshot } from '../core/snapshot.js';
import { summarizeChannelResults } from '../core/result.js';
import { createLogger } from '../ui/log.js';
import { banner } from '../ui/banner.js';
import { t } from '../ui/i18n.js';
import { createTTYPrompt, type PromptService } from '../ui/prompt.js';
import { runInteractiveWizard, type InstallPlan } from '../ui/wizard.js';
import { runUninstall } from './uninstall.js';
import { runStatus } from './status.js';

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

function shouldPrompt(args: GlobalArgs, isTTY: boolean): boolean {
  if (!isTTY) return false;
  if (args.interactiveDefault) return true;
  if (
    args.command === 'install' &&
    !args.explicitBaseUrl &&
    !args.channels &&
    !args.pre &&
    !args.dev &&
    !args.skipDocker &&
    !args.force &&
    !args.explicitApiToken
  ) {
    return true;
  }
  return false;
}

async function executeInstallPlan(
  plan: {
    lang: Lang;
    baseUrl?: string;
    apiToken?: string;
    channels: ChannelId[];
    pre: boolean;
    dev: boolean;
    force: boolean;
    skipDocker: boolean;
    explicitBaseUrl: boolean;
  },
  deps: {
    env: NodeJS.ProcessEnv;
    run: ExecFn;
    fetchImpl: typeof fetch;
    log: ReturnType<typeof createLogger>;
    loreHome: string;
    configPath: string;
  },
): Promise<number> {
  const { env, run, fetchImpl, log, loreHome, configPath } = deps;
  const saved = await readConfig(configPath);
  let apiToken = plan.apiToken;
  if (!apiToken) apiToken = saved.api_token;

  const docker = await ensureDockerServer({
    loreHome,
    explicitBaseUrl: plan.explicitBaseUrl ? plan.baseUrl : undefined,
    skipDocker: plan.skipDocker,
    pre: plan.pre,
    dev: plan.dev,
    saved,
    run,
    fetchImpl,
  });

  const resolvedBase = (
    docker.baseUrl ||
    plan.baseUrl ||
    saved.base_url ||
    'http://127.0.0.1:18901'
  ).replace(/\/$/, '');

  const releaseInfo = await fetchReleaseTag({
    pre: plan.pre,
    dev: plan.dev,
    fetchImpl,
  });
  let needInstall: NeedInstall = releaseInfo.needInstallHint;
  let releaseVersion = releaseInfo.tag ?? undefined;
  if (releaseVersion) {
    needInstall = resolveNeedInstall({
      installed: saved.installed_version,
      release: releaseVersion,
      force: plan.force,
    });
  } else if (releaseInfo.needInstallHint === 1) {
    needInstall = 1;
  }

  // Always persist connection config even if plugin install fails later.
  await writeConfig(
    configPath,
    { base_url: resolvedBase, api_token: apiToken },
    {
      writeVersion: false,
      dockerManaged: docker.dockerManaged === null ? undefined : docker.dockerManaged,
    },
  );

  log.info(`Server: ${resolvedBase}`);
  log.info(
    `Channels: ${plan.channels.join(',')} (${plan.dev ? 'dev' : plan.pre ? 'pre-release' : 'stable'})`,
  );

  if (!releaseVersion) {
    log.err(t(plan.lang, 'install.release_unknown'));
    if (releaseInfo.error) {
      log.err(t(plan.lang, 'install.release_unknown_detail', { detail: releaseInfo.error }));
    }
  } else {
    log.info(`Release: ${releaseVersion}`);
  }

  if (!plan.channels.length) {
    log.err(t(plan.lang, 'install.no_channels'));
    return 1;
  }

  const results: ChannelResult[] = [];
  for (const id of plan.channels) {
    log.section(id);
    try {
      const installer = getInstaller(id);
      const result = await installer.install({
        loreHome,
        baseUrl: resolvedBase,
        apiToken,
        releaseVersion,
        needInstall,
        force: plan.force,
        lang: plan.lang,
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

  const outcome = summarizeChannelResults(results);
  const versionLabel = releaseVersion ?? 'unknown';

  // Only bump installed_version when we actually applied a known release and had some success.
  const shouldBumpVersion =
    Boolean(releaseVersion) && needInstall !== 2 && outcome.ok > 0;

  await writeConfig(
    configPath,
    { base_url: resolvedBase, api_token: apiToken },
    {
      writeVersion: shouldBumpVersion,
      releaseVersion,
      dockerManaged: docker.dockerManaged === null ? undefined : docker.dockerManaged,
    },
  );

  if (outcome.kind === 'success') {
    log.ok(t(plan.lang, 'install.complete', { version: versionLabel }));
    log.info(t(plan.lang, 'config.path', { path: configPath }));
    log.info(t(plan.lang, 'setup.url', { baseUrl: resolvedBase }));
    log.info(t(plan.lang, 'restart.next', { baseUrl: resolvedBase }));
    return 0;
  }

  if (outcome.kind === 'partial') {
    log.err(
      t(plan.lang, 'install.partial', {
        version: versionLabel,
        ok: String(outcome.ok),
        failed: String(outcome.failed),
        skipped: String(outcome.skipped),
      }),
    );
  } else {
    log.err(
      t(plan.lang, 'install.failed', {
        version: versionLabel,
        ok: String(outcome.ok),
        failed: String(outcome.failed),
        skipped: String(outcome.skipped),
      }),
    );
  }
  log.info(t(plan.lang, 'config.path', { path: configPath }));
  // Do not print restart/success next-steps on failure.
  return outcome.exitCode;
}

export async function runInstall(args: GlobalArgs, deps: InstallDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const run = deps.run ?? createExec();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const log = deps.log ?? createLogger();
  let lang = resolveLang(args, env);
  const loreHome = getLoreHome(env);
  const configPath = getConfigPath(loreHome);
  const homeDir = env.HOME || undefined;

  if (!isTTY && args.interactiveDefault) {
    console.error('Interactive install requires a TTY. Pass flags (e.g. --base-url, --channels).');
    return 2;
  }

  const saved = await readConfig(configPath);

  if (shouldPrompt(args, isTTY)) {
    const prompt = deps.prompt === null ? null : (deps.prompt ?? createTTYPrompt({ lang }));
    if (prompt) {
      banner(lang);
      const snapshot = await collectInstallSnapshot({
        loreHome,
        configPath,
        config: saved,
        homeDir,
        env,
      });
      const wizard = await runInteractiveWizard({
        prompt,
        snapshot,
        initialLang: lang,
        langLocked: Boolean(args.lang || env.LORE_INSTALL_LANG),
        env,
      });

      if (wizard.kind === 'exit') {
        const exitLang = wizard.lang;
        log.err(exitLang === 'zh' ? '已取消。' : 'Aborted.');
        return 1;
      }
      if (wizard.kind === 'status') {
        return runStatus({ ...args, lang: wizard.lang }, { env, log });
      }
      if (wizard.kind === 'uninstall') {
        return runUninstall(
          {
            ...args,
            command: 'uninstall',
            channels: wizard.channels,
            purge: wizard.purge,
            yes: true,
            lang: wizard.lang,
          },
          { env, run, isTTY, log },
        );
      }

      const plan = wizard.plan;
      return executeInstallPlan(
        {
          lang: plan.lang,
          baseUrl: plan.baseUrl,
          apiToken: plan.apiToken,
          channels: plan.channels,
          pre: plan.pre,
          dev: plan.dev,
          force: plan.force,
          skipDocker: plan.skipDocker,
          explicitBaseUrl: plan.explicitBaseUrl,
        },
        { env, run, fetchImpl, log, loreHome, configPath },
      );
    }
  }

  // Non-interactive / flag path
  return executeInstallPlan(
    {
      lang,
      baseUrl: args.baseUrl,
      apiToken: args.apiToken ?? saved.api_token,
      channels: resolveChannels(args),
      pre: args.pre,
      dev: args.dev,
      force: args.force,
      skipDocker: args.skipDocker,
      explicitBaseUrl: args.explicitBaseUrl,
    },
    { env, run, fetchImpl, log, loreHome, configPath },
  );
}

export async function runUpdate(args: GlobalArgs, deps: InstallDeps = {}): Promise<number> {
  return runInstall({ ...args, interactiveDefault: false, command: 'install' }, deps);
}

/** Exposed for tests */
export type { InstallPlan };

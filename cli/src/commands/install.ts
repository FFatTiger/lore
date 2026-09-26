import {
  type ChannelId,
  type ChannelResult,
  type ConnectionMode,
  type InstallOperation,
  type Lang,
  type NeedInstall,
} from '../core/types.js';
import type { GlobalArgs } from '../core/args.js';
import { getConfigPath, getLoreHome } from '../core/paths.js';
import { readConfig, writeConfig } from '../core/config.js';
import { assertTokenTransport, normalizeBaseUrl, resolveTokenDecision } from '../core/connection.js';
import { ensureDockerServer } from '../core/docker.js';
import { fetchReleaseTag, resolveNeedInstall } from '../core/release.js';
import { createExec, type ExecFn } from '../core/exec.js';
import { getInstaller } from '../channels/registry.js';
import { collectInstallSnapshot } from '../core/snapshot.js';
import { summarizeChannelResults } from '../core/result.js';
import { isSaasBaseUrl } from '../core/saas.js';
import { createLogger } from '../ui/log.js';
import { banner } from '../ui/banner.js';
import { t } from '../ui/i18n.js';
import { createTTYPrompt, type PromptService } from '../ui/prompt.js';
import { runInteractiveWizard, type InstallPlan, type WizardPresets } from '../ui/wizard.js';
import { runUninstall } from './uninstall.js';
import { runStatus } from './status.js';

export type InstallDeps = {
  env?: NodeJS.ProcessEnv;
  run?: ExecFn;
  artifactRun?: ExecFn;
  fetchImpl?: typeof fetch;
  isTTY?: boolean;
  prompt?: PromptService | null;
  log?: ReturnType<typeof createLogger>;
};

type ExecutionPlan = {
  operation: InstallOperation;
  connectionMode: ConnectionMode;
  lang: Lang;
  baseUrl?: string;
  apiToken?: string;
  explicitToken: boolean;
  channels: ChannelId[];
  pre: boolean;
  dev: boolean;
  force: boolean;
  skipDocker: boolean;
  allowInsecureHttp: boolean;
};

function resolveLang(args: GlobalArgs, env: NodeJS.ProcessEnv): Lang {
  if (args.lang) return args.lang;
  const fromEnv = env.LORE_INSTALL_LANG?.trim().toLowerCase();
  return fromEnv === 'zh' ? 'zh' : 'en';
}

function shouldPrompt(args: GlobalArgs, isTTY: boolean): boolean {
  return isTTY && args.interactiveDefault;
}

function wizardPresets(args: GlobalArgs): WizardPresets {
  return {
    baseUrl: args.baseUrl,
    apiToken: args.apiToken,
    channels: args.channels,
    docker: args.docker,
    release: args.dev ? 'dev' : args.pre ? 'pre' : undefined,
    force: args.force || undefined,
    allowInsecureHttp: args.allowInsecureHttp || undefined,
  };
}

function missingConnectionMessage(lang: Lang): string {
  return lang === 'zh'
    ? '未配置 Lore 服务。请用 --base-url URL 连接已有服务，或用 --docker 在本机部署。'
    : 'No Lore server configured. Pass --base-url URL to connect to an existing server, or --docker to self-host locally.';
}

function noDetectedChannelsMessage(lang: Lang): string {
  return lang === 'zh'
    ? '未检测到任何受支持的 Agent 运行时。请用 --channels 指定要安装的渠道。'
    : 'No supported agent runtimes detected. Pass --channels to choose integrations explicitly.';
}

function usageError(log: ReturnType<typeof createLogger>, error: unknown): number {
  log.err(error instanceof Error ? error.message : String(error));
  return 2;
}

async function executeInstallPlan(
  plan: ExecutionPlan,
  deps: {
    env: NodeJS.ProcessEnv;
    run: ExecFn;
    artifactRun?: ExecFn;
    fetchImpl: typeof fetch;
    log: ReturnType<typeof createLogger>;
    loreHome: string;
    configPath: string;
  },
): Promise<number> {
  const { env, run, artifactRun, fetchImpl, log, loreHome, configPath } = deps;

  if (!plan.channels.length) {
    log.err(t(plan.lang, 'install.no_channels'));
    return 1;
  }

  let saved;
  try {
    saved = await readConfig(configPath);
  } catch (error) {
    log.err(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let explicitBaseUrl: string | undefined;
  if (plan.connectionMode === 'external') {
    try {
      if (!plan.baseUrl) throw new Error('External Lore server URL is required');
      explicitBaseUrl = normalizeBaseUrl(plan.baseUrl);
    } catch (error) {
      return usageError(log, error);
    }
  }

  let docker;
  try {
    docker = await ensureDockerServer({
      loreHome,
      connectionMode: plan.connectionMode,
      explicitBaseUrl,
      skipDocker: plan.skipDocker,
      pre: plan.pre,
      dev: plan.dev,
      saved,
      run,
      fetchImpl,
    });
  } catch (error) {
    log.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (!docker.ok) {
    log.err(docker.error);
    return 1;
  }

  let resolvedBase: string;
  let tokenDecision;
  try {
    resolvedBase = normalizeBaseUrl(docker.baseUrl);
    tokenDecision = resolveTokenDecision({
      savedBaseUrl: saved.base_url,
      savedToken: saved.api_token,
      targetBaseUrl: resolvedBase,
      requestedToken: plan.apiToken,
      explicitToken: plan.explicitToken,
      forceClear: plan.connectionMode === 'docker',
    });
  } catch (error) {
    log.err(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const apiToken = tokenDecision.apiToken;
  try {
    if (isSaasBaseUrl(resolvedBase, env) && !apiToken) {
      throw new Error('Loremem SaaS requires an API token');
    }
    assertTokenTransport(resolvedBase, apiToken, {
      allowInsecureHttp: plan.allowInsecureHttp,
    });
  } catch (error) {
    return usageError(log, error);
  }

  const releaseInfo = await fetchReleaseTag({
    pre: plan.pre,
    dev: plan.dev,
    fetchImpl,
  });
  if (!releaseInfo.tag && plan.operation === 'update') {
    log.err(t(plan.lang, 'install.release_unknown'));
    if (releaseInfo.error) {
      log.err(t(plan.lang, 'install.release_unknown_detail', { detail: releaseInfo.error }));
    }
    return 1;
  }

  let needInstall: NeedInstall = releaseInfo.needInstallHint;
  const releaseVersion = releaseInfo.tag ?? undefined;
  if (releaseVersion) {
    needInstall = resolveNeedInstall({
      installed: saved.installed_version,
      release: releaseVersion,
      force: plan.force,
    });
  } else if (releaseInfo.needInstallHint === 1) {
    needInstall = 1;
  }

  try {
    await writeConfig(
      configPath,
      { base_url: resolvedBase, api_token: apiToken },
      {
        tokenAction: tokenDecision.action,
        writeVersion: false,
        dockerManaged: docker.dockerManaged,
      },
    );
  } catch (error) {
    log.err(error instanceof Error ? error.message : String(error));
    return 1;
  }

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

  const results: ChannelResult[] = [];
  for (const id of plan.channels) {
    log.section(id);
    try {
      const result = await getInstaller(id).install({
        loreHome,
        baseUrl: resolvedBase,
        apiToken,
        tokenAction: tokenDecision.action,
        releaseVersion,
        needInstall,
        force: plan.force,
        lang: plan.lang,
        run,
        artifactRun,
        env,
        homeDir: env.HOME || undefined,
      });
      results.push(result);
      if (result.status === 'ok') log.ok(result.message ?? `${id} ok`);
      else if (result.status === 'skipped') log.warn(result.message ?? `${id} skipped`);
      else log.err(result.message ?? `${id} failed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id, status: 'failed', message });
      log.err(`${id}: ${message}`);
    }
  }

  const outcome = summarizeChannelResults(results);
  const updateIncomplete = plan.operation === 'update' && outcome.skipped > 0;
  const versionLabel = releaseVersion ?? 'unknown';
  const shouldBumpVersion =
    Boolean(releaseVersion) &&
    needInstall !== 2 &&
    outcome.ok > 0 &&
    outcome.failed === 0 &&
    outcome.skipped === 0;

  try {
    await writeConfig(
      configPath,
      { base_url: resolvedBase, api_token: apiToken },
      {
        tokenAction: tokenDecision.action,
        writeVersion: shouldBumpVersion,
        releaseVersion,
        dockerManaged: docker.dockerManaged,
      },
    );
  } catch (error) {
    log.err(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (outcome.kind === 'success' && !updateIncomplete) {
    log.ok(t(plan.lang, 'install.complete', { version: versionLabel }));
    log.info(t(plan.lang, 'config.path', { path: configPath }));
    log.info(t(plan.lang, 'setup.url', { baseUrl: resolvedBase }));
    log.info(t(plan.lang, 'restart.next', { baseUrl: resolvedBase }));
    return 0;
  }

  if (outcome.kind === 'partial' || updateIncomplete) {
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
  return updateIncomplete ? 1 : outcome.exitCode;
}

async function runInstallOperation(
  operation: InstallOperation,
  args: GlobalArgs,
  deps: InstallDeps,
): Promise<number> {
  const env = deps.env ?? process.env;
  const run = deps.run ?? createExec();
  const artifactRun = deps.artifactRun;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const log = deps.log ?? createLogger();
  const lang = resolveLang(args, env);
  const loreHome = getLoreHome(env);
  const configPath = getConfigPath(loreHome);
  const homeDir = env.HOME || undefined;

  if (!isTTY && args.bare) {
    console.error('Interactive install requires a TTY. Pass flags (e.g. --base-url or --docker, --channels, -y).');
    return 2;
  }

  let saved;
  try {
    saved = await readConfig(configPath);
  } catch (error) {
    log.err(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (operation === 'install' && shouldPrompt(args, isTTY)) {
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
        presets: wizardPresets(args),
      });

      if (wizard.kind === 'exit') {
        log.err(wizard.reason ?? (wizard.lang === 'zh' ? '已取消。' : 'Aborted.'));
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
          operation: plan.operation,
          connectionMode: plan.connectionMode,
          lang: plan.lang,
          baseUrl: plan.baseUrl,
          apiToken: plan.apiToken,
          explicitToken: Boolean(plan.apiToken),
          channels: plan.channels,
          pre: plan.pre,
          dev: plan.dev,
          force: plan.force,
          skipDocker: plan.skipDocker,
          allowInsecureHttp: plan.allowInsecureHttp,
        },
        { env, run, artifactRun, fetchImpl, log, loreHome, configPath },
      );
    }
  }

  // Parameter mode: required connection must come from flags or saved config;
  // everything else falls back to defaults.
  let connectionMode: ConnectionMode;
  if (args.explicitBaseUrl) {
    connectionMode = 'external';
  } else if (args.docker) {
    connectionMode = 'docker';
  } else if (args.skipDocker || operation === 'update' || saved.base_url) {
    connectionMode = 'preserve';
  } else {
    return usageError(log, missingConnectionMessage(lang));
  }

  let channels: ChannelId[];
  if (args.channels?.length) {
    channels = args.channels;
  } else {
    const snapshot = await collectInstallSnapshot({
      loreHome,
      configPath,
      config: saved,
      homeDir,
      env,
    });
    if (operation === 'update') {
      channels = snapshot.channels
        .filter((channel) => channel.state === 'installed' || channel.state === 'partial')
        .map((channel) => channel.id);
      if (!channels.length) {
        log.err('Update failed — no installed or partial channels found');
        return 1;
      }
    } else {
      channels = snapshot.detectedChannels;
      if (!channels.length) return usageError(log, noDetectedChannelsMessage(lang));
    }
  }

  return executeInstallPlan(
    {
      operation,
      connectionMode,
      lang,
      baseUrl: args.baseUrl,
      apiToken: args.apiToken,
      explicitToken: args.explicitApiToken,
      channels,
      pre: args.pre,
      dev: args.dev,
      force: args.force,
      skipDocker: args.skipDocker,
      allowInsecureHttp: args.allowInsecureHttp,
    },
    { env, run, artifactRun, fetchImpl, log, loreHome, configPath },
  );
}

export async function runInstall(args: GlobalArgs, deps: InstallDeps = {}): Promise<number> {
  return runInstallOperation('install', args, deps);
}

export async function runUpdate(args: GlobalArgs, deps: InstallDeps = {}): Promise<number> {
  return runInstallOperation('update', args, deps);
}

/** Exposed for tests */
export type { InstallPlan };

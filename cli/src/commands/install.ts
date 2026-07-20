import { ALL_CHANNELS, type ChannelId, type ChannelResult, type Lang, type NeedInstall } from '../core/types.js';
import type { GlobalArgs } from '../core/args.js';
import { getConfigPath, getLoreHome } from '../core/paths.js';
import { readConfig, writeConfig } from '../core/config.js';
import { ensureDockerServer } from '../core/docker.js';
import { fetchReleaseTag, resolveNeedInstall } from '../core/release.js';
import { createExec, type ExecFn } from '../core/exec.js';
import { detectAgents } from '../core/detect.js';
import { getInstaller } from '../channels/registry.js';
import { createLogger } from '../ui/log.js';
import { banner } from '../ui/banner.js';
import { t } from '../ui/i18n.js';
import { createTTYPrompt, type PromptService } from '../ui/prompt.js';

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

function detectedChannelIds(agents: Awaited<ReturnType<typeof detectAgents>>): ChannelId[] {
  const map: Array<[ChannelId, boolean]> = [
    ['claudecode', agents.claude],
    ['codex', agents.codex],
    ['pi', agents.pi],
    ['openclaw', agents.openclaw],
    ['opencode', agents.opencode],
    // hermes has no reliable CLI probe in detectAgents (often absent); still optional
    ['hermes', agents.hermes],
  ];
  return map.filter(([, on]) => on).map(([id]) => id);
}

/**
 * When should we open the interactive wizard?
 * - bare `npx @loremem/cli` (interactiveDefault)
 * - or TTY install without enough non-interactive intent flags
 */
function shouldPrompt(args: GlobalArgs, isTTY: boolean): boolean {
  if (!isTTY) return false;
  if (args.interactiveDefault) return true;
  // install with no explicit base-url/channels/pre/dev/skip-docker/force/token → guide user
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

export async function runInstall(args: GlobalArgs, deps: InstallDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const run = deps.run ?? createExec();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const log = deps.log ?? createLogger();
  let lang = resolveLang(args, env);
  const loreHome = getLoreHome(env);
  const configPath = getConfigPath(loreHome);

  if (!isTTY && args.interactiveDefault) {
    console.error('Interactive install requires a TTY. Pass flags (e.g. --base-url, --channels).');
    return 2;
  }

  let baseUrl = args.baseUrl;
  let apiToken = args.apiToken;
  let channels = resolveChannels(args);
  let pre = args.pre;
  let dev = args.dev;
  let skipDocker = args.skipDocker;
  let explicitBaseUrl = args.explicitBaseUrl;
  let force = args.force;

  const saved = await readConfig(configPath);
  if (!apiToken && !args.explicitApiToken) apiToken = saved.api_token;

  if (shouldPrompt(args, isTTY)) {
    const prompt = deps.prompt === null ? null : (deps.prompt ?? createTTYPrompt({ lang }));
    if (prompt) {
      banner(lang);
      const agents = await detectAgents();
      const detected = detectedChannelIds(agents);
      log.info(
        lang === 'zh'
          ? `检测到 CLI：${Object.entries(agents)
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join(', ') || '无'}`
          : `Detected CLIs: ${Object.entries(agents)
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join(', ') || 'none'}`,
      );

      const mode = await prompt.selectMode();
      if (mode === 'external') {
        baseUrl = await prompt.askBaseUrl(baseUrl || saved.base_url || 'https://api.loremem.com');
        const tokenIn = await prompt.askToken();
        if (tokenIn) apiToken = tokenIn;
        skipDocker = true;
        explicitBaseUrl = true;
      } else {
        // local docker path — may still reuse saved external if config says so inside docker module
        const release = await prompt.pickRelease();
        pre = release === 'pre';
        dev = release === 'dev';
        // if user already has external config, still allow docker managed update only when docker_managed
        if (saved.base_url && !saved.docker_managed && !args.force) {
          // keep going; ensureDockerServer will use saved external unless skipDocker false and no explicit
        }
      }

      channels = await prompt.pickChannels(detected.length ? detected : [...ALL_CHANNELS]);
      if (!channels.length) channels = [...ALL_CHANNELS];

      const summary =
        lang === 'zh'
          ? `将执行安装\n  服务: ${baseUrl ?? '(本机 Docker / 已保存配置)'}\n  渠道: ${channels.join(', ')}\n  通道: ${dev ? 'dev' : pre ? 'pre' : 'stable'}\n  token: ${apiToken ? '已设置' : '未设置'}`
          : `About to install\n  server: ${baseUrl ?? '(local Docker / saved config)'}\n  channels: ${channels.join(', ')}\n  release: ${dev ? 'dev' : pre ? 'pre' : 'stable'}\n  token: ${apiToken ? 'set' : 'absent'}`;

      const ok = await prompt.confirm(summary);
      if (!ok) {
        log.err(lang === 'zh' ? '已取消。' : 'Aborted.');
        return 1;
      }
    }
  }

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
      force,
    });
  } else if (releaseInfo.needInstallHint === 1) {
    needInstall = 1;
  }

  await writeConfig(
    configPath,
    { base_url: resolvedBase, api_token: apiToken },
    {
      writeVersion: false,
      dockerManaged: docker.dockerManaged === null ? undefined : docker.dockerManaged,
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
        force,
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
      dockerManaged: docker.dockerManaged === null ? undefined : docker.dockerManaged,
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
  // Update reuses install path but is non-interactive by default.
  return runInstall({ ...args, interactiveDefault: false, command: 'install' }, deps);
}

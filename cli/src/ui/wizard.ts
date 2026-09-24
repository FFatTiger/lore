import type {
  ChannelId,
  ConnectionMode as InstallConnectionMode,
  InstallOperation,
  Lang,
} from '../core/types.js';
import type { InstallSnapshot } from '../core/snapshot.js';
import { formatSnapshot, selectableChannels } from '../core/snapshot.js';
import { defaultSaasBaseUrl, isSaasBaseUrl } from '../core/saas.js';
import { isInsecureHttpTokenTransport, normalizeBaseUrl } from '../core/connection.js';
import { t } from './i18n.js';
import type {
  ConnectionMode,
  ExistingAction,
  PromptService,
  ReleaseChannel,
} from './prompt.js';

export type WizardResult =
  | { kind: 'install'; plan: InstallPlan }
  | { kind: 'uninstall'; channels: ChannelId[]; purge: boolean; lang: Lang }
  | { kind: 'status'; lang: Lang }
  | { kind: 'exit'; lang: Lang; reason?: string };

export type InstallPlan = {
  operation: InstallOperation;
  connectionMode: InstallConnectionMode;
  lang: Lang;
  baseUrl?: string;
  apiToken?: string;
  channels: ChannelId[];
  pre: boolean;
  dev: boolean;
  force: boolean;
  skipDocker: boolean;
  explicitBaseUrl: boolean;
  /** Keep existing token if wizard left it blank. */
  keepExistingToken: boolean;
  /** Runtime-only approval; never persisted to config. */
  allowInsecureHttp: boolean;
};

/** Command-line values that preselect wizard answers; every one stays editable. */
export type WizardPresets = {
  baseUrl?: string;
  apiToken?: string;
  channels?: ChannelId[];
  docker?: boolean;
  release?: ReleaseChannel;
  force?: boolean;
  allowInsecureHttp?: boolean;
};

export type RunWizardOptions = {
  prompt: PromptService;
  snapshot: InstallSnapshot;
  initialLang: Lang;
  langLocked: boolean;
  env?: NodeJS.ProcessEnv;
  presets?: WizardPresets;
};

function canKeepExistingToken(snapshot: InstallSnapshot, baseUrl: string | undefined): boolean {
  if (!baseUrl || !snapshot.config.base_url || !snapshot.config.api_token) return false;
  try {
    return normalizeBaseUrl(baseUrl) === normalizeBaseUrl(snapshot.config.base_url);
  } catch {
    return false;
  }
}

function effectivePlanToken(plan: InstallPlan, snapshot: InstallSnapshot): string | undefined {
  if (plan.apiToken) return plan.apiToken;
  return plan.keepExistingToken ? snapshot.config.api_token : undefined;
}

function presetConnectionMode(
  presets: WizardPresets,
  env: NodeJS.ProcessEnv,
): ConnectionMode | undefined {
  if (presets.docker) return 'docker';
  if (presets.baseUrl) return isSaasBaseUrl(presets.baseUrl, env) ? 'saas' : 'external';
  return undefined;
}

function noRuntimesReason(lang: Lang): string {
  return lang === 'zh'
    ? '未检测到任何受支持的 Agent 运行时（claude、codex、pi、openclaw、opencode、hermes）。请先安装后再运行，或用 --channels 指定。'
    : 'No supported agent runtimes detected (claude, codex, pi, openclaw, opencode, hermes). Install one first or pass --channels.';
}

function noChannelsReason(lang: Lang): string {
  return t(lang, 'install.no_channels');
}

async function confirmInstallPlan(
  prompt: PromptService,
  plan: InstallPlan,
  snapshot: InstallSnapshot,
  summary: string,
  presets: WizardPresets,
): Promise<boolean> {
  const token = effectivePlanToken(plan, snapshot);
  if (plan.baseUrl) {
    let normalizedBaseUrl: string;
    try {
      normalizedBaseUrl = normalizeBaseUrl(plan.baseUrl);
    } catch {
      // Preserve the existing flow: the execution-layer URL validation reports this later.
      return prompt.confirm(summary);
    }
    if (!isInsecureHttpTokenTransport(normalizedBaseUrl, token)) {
      return prompt.confirm(summary);
    }
    const allowed = await prompt.askYesNo(
      t(plan.lang, 'security.insecure_http_token_warning', {
        baseUrl: normalizedBaseUrl,
      }),
      presets.allowInsecureHttp ?? false,
    );
    if (!allowed) return false;
    plan.allowInsecureHttp = true;
  }
  return prompt.confirm(summary);
}

async function collectConnection(
  prompt: PromptService,
  mode: ConnectionMode,
  snapshot: InstallSnapshot,
  env: NodeJS.ProcessEnv,
  presets: WizardPresets,
): Promise<Pick<InstallPlan, 'connectionMode' | 'baseUrl' | 'apiToken' | 'skipDocker' | 'explicitBaseUrl' | 'pre' | 'dev' | 'keepExistingToken'> & { release: ReleaseChannel }> {
  let connectionMode: InstallConnectionMode = 'docker';
  let baseUrl: string | undefined;
  let apiToken = '';
  let skipDocker = false;
  let explicitBaseUrl = false;
  let keepExistingToken = false;

  if (mode === 'saas' || mode === 'external') {
    connectionMode = 'external';
    skipDocker = true;
    explicitBaseUrl = true;
    baseUrl =
      mode === 'saas'
        ? defaultSaasBaseUrl(env)
        : await prompt.askBaseUrl(
            presets.baseUrl || snapshot.config.base_url || 'http://127.0.0.1:18901',
          );
    const canKeep = canKeepExistingToken(snapshot, baseUrl);
    const hasPreset = Boolean(presets.apiToken);
    const typed = await prompt.askToken({
      required: mode === 'saas' && !canKeep && !hasPreset,
      hasExisting: canKeep,
      hasPreset,
    });
    apiToken = typed || presets.apiToken || '';
    keepExistingToken = !apiToken && canKeep;
  }
  // An explicit Docker selection never preserves a remote token.

  const release = await prompt.pickRelease(presets.release ?? 'stable');

  return {
    connectionMode,
    baseUrl,
    apiToken: apiToken || undefined,
    skipDocker,
    explicitBaseUrl,
    pre: release === 'pre',
    dev: release === 'dev',
    keepExistingToken,
    release,
  };
}

/** Channel picker for installs: only runtimes found on this machine (plus explicit presets). */
async function pickInstallChannels(
  prompt: PromptService,
  snapshot: InstallSnapshot,
  defaults: ChannelId[],
): Promise<ChannelId[]> {
  return prompt.pickChannels({
    choices: selectableChannels(snapshot, defaults),
    defaults,
    snapshot,
    purpose: 'install',
  });
}

export async function runInteractiveWizard(opts: RunWizardOptions): Promise<WizardResult> {
  const env = opts.env ?? process.env;
  const prompt = opts.prompt;
  const presets = opts.presets ?? {};
  let lang = opts.initialLang;

  if (!opts.langLocked) {
    lang = await prompt.pickLanguage(opts.initialLang);
  }

  prompt.showStatus(formatSnapshot(opts.snapshot, lang));

  const installDefaults = presets.channels ?? opts.snapshot.detectedChannels;

  if (!opts.snapshot.hasConfig) {
    if (selectableChannels(opts.snapshot, installDefaults).length === 0) {
      return { kind: 'exit', lang, reason: noRuntimesReason(lang) };
    }
    const action = await prompt.pickFirstRunAction({
      initial: presetConnectionMode(presets, env),
      dockerAvailable: opts.snapshot.agents.docker,
    });
    const conn = await collectConnection(prompt, action, opts.snapshot, env, presets);
    const channels = await pickInstallChannels(prompt, opts.snapshot, installDefaults);
    if (!channels.length) return { kind: 'exit', lang, reason: noChannelsReason(lang) };
    const plan: InstallPlan = {
      operation: 'install',
      connectionMode: conn.connectionMode,
      lang,
      baseUrl: conn.baseUrl,
      apiToken: conn.apiToken,
      channels,
      pre: conn.pre,
      dev: conn.dev,
      force: presets.force ?? false,
      skipDocker: conn.skipDocker,
      explicitBaseUrl: conn.explicitBaseUrl,
      keepExistingToken: conn.keepExistingToken,
      allowInsecureHttp: false,
    };
    const summary = formatInstallSummary(plan, action, lang);
    const ok = await confirmInstallPlan(prompt, plan, opts.snapshot, summary, presets);
    if (!ok) return { kind: 'exit', lang };
    return { kind: 'install', plan };
  }

  // Existing install
  const presetMode = presetConnectionMode(presets, env);
  const existing = await prompt.pickExistingAction(presetMode ? 'reconfigure' : 'update');
  if (existing === 'exit' || existing === 'status') {
    return { kind: existing === 'status' ? 'status' : 'exit', lang };
  }

  if (existing === 'uninstall') {
    const installed = opts.snapshot.channels
      .filter((c) => c.state === 'installed' || c.state === 'partial')
      .map((c) => c.id);
    const defaults = presets.channels ?? installed;
    const choices = selectableChannels(opts.snapshot, defaults);
    if (!choices.length) return { kind: 'exit', lang, reason: noChannelsReason(lang) };
    const channels = await prompt.pickChannels({
      choices,
      defaults,
      snapshot: opts.snapshot,
      purpose: 'uninstall',
    });
    if (!channels.length) return { kind: 'exit', lang, reason: noChannelsReason(lang) };
    const purge = await prompt.askYesNo(
      lang === 'zh' ? '是否同时清除 ~/.lore 配置与 Docker 数据？' : 'Also purge ~/.lore config and Docker data?',
      false,
    );
    const ok = await prompt.confirm(
      lang === 'zh'
        ? `将卸载：${channels.join(', ')}\npurge: ${purge ? '是' : '否'}`
        : `Will uninstall: ${channels.join(', ')}\npurge: ${purge}`,
    );
    if (!ok) return { kind: 'exit', lang };
    return { kind: 'uninstall', channels, purge, lang };
  }

  if (existing === 'reconfigure') {
    if (selectableChannels(opts.snapshot, installDefaults).length === 0) {
      return { kind: 'exit', lang, reason: noRuntimesReason(lang) };
    }
    const mode = await prompt.pickFirstRunAction({
      initial: presetMode ?? (opts.snapshot.serverKind === 'unknown' ? undefined : opts.snapshot.serverKind),
      dockerAvailable: opts.snapshot.agents.docker,
    });
    const conn = await collectConnection(prompt, mode, opts.snapshot, env, presets);
    const channels = await pickInstallChannels(prompt, opts.snapshot, installDefaults);
    if (!channels.length) return { kind: 'exit', lang, reason: noChannelsReason(lang) };
    const plan: InstallPlan = {
      operation: 'install',
      connectionMode: conn.connectionMode,
      lang,
      baseUrl: conn.baseUrl,
      apiToken: conn.apiToken,
      channels,
      pre: conn.pre,
      dev: conn.dev,
      force: true,
      skipDocker: conn.skipDocker,
      explicitBaseUrl: conn.explicitBaseUrl,
      keepExistingToken: conn.keepExistingToken,
      allowInsecureHttp: false,
    };
    const ok = await confirmInstallPlan(
      prompt,
      plan,
      opts.snapshot,
      formatInstallSummary(plan, mode, lang),
      presets,
    );
    if (!ok) return { kind: 'exit', lang };
    return { kind: 'install', plan };
  }

  // update or manage plugins — keep server/token
  const force =
    existing === 'update'
      ? await prompt.askYesNo(
          lang === 'zh' ? '强制重装（即使版本相同）？' : 'Force reinstall even if version unchanged?',
          presets.force ?? false,
        )
      : true;

  const release = await prompt.pickRelease(presets.release ?? 'stable');
  const installed = opts.snapshot.channels
    .filter((c) => c.state === 'installed' || c.state === 'partial')
    .map((c) => c.id);
  const defaults =
    presets.channels ??
    (existing === 'update' && installed.length ? installed : opts.snapshot.detectedChannels);
  if (selectableChannels(opts.snapshot, defaults).length === 0) {
    return { kind: 'exit', lang, reason: noRuntimesReason(lang) };
  }
  const channels = await pickInstallChannels(prompt, opts.snapshot, defaults);
  if (!channels.length) return { kind: 'exit', lang, reason: noChannelsReason(lang) };

  const kind = opts.snapshot.serverKind;
  const plan: InstallPlan = {
    operation: existing === 'update' ? 'update' : 'install',
    connectionMode: 'preserve',
    lang,
    baseUrl: opts.snapshot.config.base_url,
    apiToken: undefined,
    channels,
    pre: release === 'pre',
    dev: release === 'dev',
    force,
    skipDocker: kind !== 'docker',
    explicitBaseUrl: kind === 'saas' || kind === 'external',
    keepExistingToken: true,
    allowInsecureHttp: false,
  };

  const ok = await confirmInstallPlan(
    prompt,
    plan,
    opts.snapshot,
    formatInstallSummary(plan, existing === 'update' ? 'update' : 'manage', lang),
    presets,
  );
  if (!ok) return { kind: 'exit', lang };
  return { kind: 'install', plan };
}

function formatInstallSummary(
  plan: InstallPlan,
  mode: ConnectionMode | ExistingAction | 'update' | 'manage',
  lang: Lang,
): string {
  const release = plan.dev ? 'dev' : plan.pre ? 'pre' : 'stable';
  if (lang === 'zh') {
    return [
      '将执行',
      `• 动作：${String(mode)}`,
      `• 服务：${plan.baseUrl ?? '(Docker / 已保存)'}`,
      `• Token：${plan.apiToken ? '新输入' : plan.keepExistingToken ? '保留已有' : '未设置'}`,
      `• 渠道：${plan.channels.join(', ')}`,
      `• 发布通道：${release}`,
      `• 强制重装：${plan.force ? '是' : '否'}`,
    ].join('\n');
  }
  return [
    'Will run',
    `• Action: ${String(mode)}`,
    `• Server: ${plan.baseUrl ?? '(Docker / saved)'}`,
    `• Token: ${plan.apiToken ? 'new' : plan.keepExistingToken ? 'keep existing' : 'absent'}`,
    `• Channels: ${plan.channels.join(', ')}`,
    `• Release: ${release}`,
    `• Force reinstall: ${plan.force ? 'yes' : 'no'}`,
  ].join('\n');
}

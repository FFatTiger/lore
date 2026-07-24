import type { ChannelId, ConnectionMode as InstallConnectionMode, Lang } from '../core/types.js';
import { ALL_CHANNELS } from '../core/types.js';
import type { InstallSnapshot } from '../core/snapshot.js';
import { formatSnapshot } from '../core/snapshot.js';
import { defaultSaasBaseUrl } from '../core/saas.js';
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
  | { kind: 'exit'; lang: Lang };

export type InstallPlan = {
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
};

export type RunWizardOptions = {
  prompt: PromptService;
  snapshot: InstallSnapshot;
  initialLang: Lang;
  langLocked: boolean;
  env?: NodeJS.ProcessEnv;
};

async function collectConnection(
  prompt: PromptService,
  mode: ConnectionMode,
  snapshot: InstallSnapshot,
  env: NodeJS.ProcessEnv,
): Promise<Pick<InstallPlan, 'connectionMode' | 'baseUrl' | 'apiToken' | 'skipDocker' | 'explicitBaseUrl' | 'pre' | 'dev' | 'keepExistingToken'> & { release: ReleaseChannel }> {
  const hasToken = Boolean(snapshot.config.api_token);
  let connectionMode: InstallConnectionMode = 'docker';
  let baseUrl: string | undefined;
  let apiToken = '';
  let skipDocker = false;
  let explicitBaseUrl = false;
  let release: ReleaseChannel = 'stable';
  let keepExistingToken = true;

  if (mode === 'saas') {
    connectionMode = 'external';
    baseUrl = defaultSaasBaseUrl(env);
    skipDocker = true;
    explicitBaseUrl = true;
    apiToken = await prompt.askToken({ required: !hasToken, hasExisting: hasToken });
    keepExistingToken = !apiToken;
    release = await prompt.pickRelease('stable');
  } else if (mode === 'external') {
    connectionMode = 'external';
    baseUrl = await prompt.askBaseUrl(snapshot.config.base_url || 'http://127.0.0.1:18901');
    skipDocker = true;
    explicitBaseUrl = true;
    apiToken = await prompt.askToken({ required: false, hasExisting: hasToken });
    keepExistingToken = !apiToken;
    release = await prompt.pickRelease('stable');
  } else {
    // An explicit Docker selection never preserves a remote token.
    connectionMode = 'docker';
    keepExistingToken = false;
    skipDocker = false;
    explicitBaseUrl = false;
    release = await prompt.pickRelease('stable');
  }

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

export async function runInteractiveWizard(opts: RunWizardOptions): Promise<WizardResult> {
  const env = opts.env ?? process.env;
  const prompt = opts.prompt;
  let lang = opts.initialLang;

  if (!opts.langLocked) {
    lang = await prompt.pickLanguage(opts.initialLang);
  }

  prompt.showStatus(formatSnapshot(opts.snapshot, lang));

  if (!opts.snapshot.hasConfig) {
    const action = await prompt.pickFirstRunAction();
    const conn = await collectConnection(prompt, action, opts.snapshot, env);
    const defaults =
      opts.snapshot.detectedChannels.length > 0
        ? opts.snapshot.detectedChannels
        : [...ALL_CHANNELS];
    const channels = await prompt.pickChannels({
      defaults,
      snapshot: opts.snapshot,
      purpose: 'install',
    });
    const plan: InstallPlan = {
      connectionMode: conn.connectionMode,
      lang,
      baseUrl: conn.baseUrl,
      apiToken: conn.apiToken,
      channels: channels.length ? channels : defaults,
      pre: conn.pre,
      dev: conn.dev,
      force: false,
      skipDocker: conn.skipDocker,
      explicitBaseUrl: conn.explicitBaseUrl,
      keepExistingToken: conn.keepExistingToken,
    };
    const summary = formatInstallSummary(plan, action, lang);
    const ok = await prompt.confirm(summary);
    if (!ok) return { kind: 'exit', lang };
    return { kind: 'install', plan };
  }

  // Existing install
  const existing = await prompt.pickExistingAction();
  if (existing === 'exit' || existing === 'status') {
    return { kind: existing === 'status' ? 'status' : 'exit', lang };
  }

  if (existing === 'uninstall') {
    const defaults = opts.snapshot.channels
      .filter((c) => c.state === 'installed' || c.state === 'partial')
      .map((c) => c.id);
    const channels = await prompt.pickChannels({
      defaults: defaults.length ? defaults : [...ALL_CHANNELS],
      snapshot: opts.snapshot,
      purpose: 'uninstall',
    });
    const purge = await prompt.askYesNo(
      lang === 'zh' ? '是否同时清除 ~/.lore 配置与 Docker 数据？' : 'Also purge ~/.lore config and Docker data?',
      false,
    );
    const ok = await prompt.confirm(
      lang === 'zh'
        ? `将卸载：${channels.join(', ') || '（无）'}\npurge: ${purge ? '是' : '否'}`
        : `Will uninstall: ${channels.join(', ') || '(none)'}\npurge: ${purge}`,
    );
    if (!ok) return { kind: 'exit', lang };
    return { kind: 'uninstall', channels, purge, lang };
  }

  if (existing === 'reconfigure') {
    const mode = await prompt.pickFirstRunAction();
    const conn = await collectConnection(prompt, mode, opts.snapshot, env);
    const defaults =
      opts.snapshot.detectedChannels.length > 0
        ? opts.snapshot.detectedChannels
        : [...ALL_CHANNELS];
    const channels = await prompt.pickChannels({
      defaults,
      snapshot: opts.snapshot,
      purpose: 'install',
    });
    const plan: InstallPlan = {
      connectionMode: conn.connectionMode,
      lang,
      baseUrl: conn.baseUrl,
      apiToken: conn.apiToken,
      channels: channels.length ? channels : defaults,
      pre: conn.pre,
      dev: conn.dev,
      force: true,
      skipDocker: conn.skipDocker,
      explicitBaseUrl: conn.explicitBaseUrl,
      keepExistingToken: conn.keepExistingToken,
    };
    const ok = await prompt.confirm(formatInstallSummary(plan, mode, lang));
    if (!ok) return { kind: 'exit', lang };
    return { kind: 'install', plan };
  }

  // update or manage plugins — keep server/token
  const force =
    existing === 'update'
      ? await prompt.askYesNo(
          lang === 'zh' ? '强制重装（即使版本相同）？' : 'Force reinstall even if version unchanged?',
          false,
        )
      : true;

  const release = await prompt.pickRelease('stable');
  const defaults =
    existing === 'update'
      ? opts.snapshot.channels
          .filter((c) => c.state === 'installed' || c.state === 'partial')
          .map((c) => c.id)
      : opts.snapshot.detectedChannels;
  const fallback =
    defaults.length > 0
      ? defaults
      : opts.snapshot.detectedChannels.length
        ? opts.snapshot.detectedChannels
        : [...ALL_CHANNELS];
  const channels = await prompt.pickChannels({
    defaults: fallback,
    snapshot: opts.snapshot,
    purpose: 'install',
  });

  const kind = opts.snapshot.serverKind;
  const plan: InstallPlan = {
    connectionMode: 'preserve',
    lang,
    baseUrl: opts.snapshot.config.base_url,
    apiToken: undefined,
    channels: channels.length ? channels : fallback,
    pre: release === 'pre',
    dev: release === 'dev',
    force,
    skipDocker: kind !== 'docker',
    explicitBaseUrl: kind === 'saas' || kind === 'external',
    keepExistingToken: true,
  };
  if (kind === 'saas' || kind === 'external') {
    plan.baseUrl = opts.snapshot.config.base_url;
  }

  const ok = await prompt.confirm(
    formatInstallSummary(plan, existing === 'update' ? 'update' : 'manage', lang),
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
      '将执行：',
      `  动作:   ${String(mode)}`,
      `  服务:   ${plan.baseUrl ?? '(Docker / 已保存)'}`,
      `  Token:  ${plan.apiToken ? '新输入' : plan.keepExistingToken ? '保留已有' : '未设置'}`,
      `  渠道:   ${plan.channels.join(', ')}`,
      `  通道:   ${release}`,
      `  force:  ${plan.force ? '是' : '否'}`,
    ].join('\n');
  }
  return [
    'Will run:',
    `  action:  ${String(mode)}`,
    `  server:  ${plan.baseUrl ?? '(Docker / saved)'}`,
    `  token:   ${plan.apiToken ? 'new' : plan.keepExistingToken ? 'keep existing' : 'absent'}`,
    `  channels:${plan.channels.join(', ')}`,
    `  release: ${release}`,
    `  force:   ${plan.force}`,
  ].join('\n');
}

import { ALL_CHANNELS, type ChannelId, type ChannelStatus, type LoreConfig } from './types.js';
import { detectAgents } from './detect.js';
import { getInstaller } from '../channels/registry.js';
import { classifyServerKind, type ServerKind } from './saas.js';

export type AgentsMap = Awaited<ReturnType<typeof detectAgents>>;

export type InstallSnapshot = {
  loreHome: string;
  configPath: string;
  config: LoreConfig;
  hasConfig: boolean;
  serverKind: ServerKind;
  agents: AgentsMap;
  channels: ChannelStatus[];
  detectedChannels: ChannelId[];
};

export async function collectInstallSnapshot(opts: {
  loreHome: string;
  configPath: string;
  config: LoreConfig;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<InstallSnapshot> {
  const env = opts.env ?? process.env;
  const agents = await detectAgents();
  const detectedChannels: ChannelId[] = (
    [
      ['claudecode', agents.claude],
      ['codex', agents.codex],
      ['pi', agents.pi],
      ['openclaw', agents.openclaw],
      ['opencode', agents.opencode],
      ['hermes', agents.hermes],
    ] as Array<[ChannelId, boolean]>
  )
    .filter(([, on]) => on)
    .map(([id]) => id);

  const channels: ChannelStatus[] = [];
  for (const id of ALL_CHANNELS) {
    try {
      channels.push(await getInstaller(id).status({ loreHome: opts.loreHome, homeDir: opts.homeDir }));
    } catch {
      channels.push({ id, state: 'unknown', details: [] });
    }
  }

  const hasConfig = Boolean(
    opts.config.base_url || opts.config.api_token || opts.config.installed_version || opts.config.docker_managed,
  );

  return {
    loreHome: opts.loreHome,
    configPath: opts.configPath,
    config: opts.config,
    hasConfig,
    serverKind: classifyServerKind({
      baseUrl: opts.config.base_url,
      dockerManaged: opts.config.docker_managed,
      env,
    }),
    agents,
    channels,
    detectedChannels,
  };
}

export function formatSnapshot(snapshot: InstallSnapshot, lang: 'en' | 'zh'): string {
  const installed = snapshot.channels.filter((channel) => channel.state === 'installed').length;
  const needsAttention = snapshot.channels.filter(
    (channel) => channel.state === 'partial' || channel.state === 'unknown',
  ).length;
  const detected = snapshot.detectedChannels.length;
  const server = snapshot.config.base_url ?? (lang === 'zh' ? '尚未配置' : 'Not configured');
  const token = snapshot.config.api_token
    ? (lang === 'zh' ? '已配置' : 'Configured')
    : (lang === 'zh' ? '未配置' : 'Not configured');
  const version = snapshot.config.installed_version ?? (lang === 'zh' ? '未安装' : 'Not installed');

  if (lang === 'zh') {
    return [
      '连接',
      `  ${server}`,
      `  Token ${token} · ${version}`,
      '',
      '运行时',
      `  检测到 ${detected} 个 · 已接入 ${installed}/${ALL_CHANNELS.length} 个`,
      needsAttention ? `  ${needsAttention} 个需要检查` : '  所有已接入插件状态正常',
      '',
      '完整明细：loremem status',
    ].join('\n');
  }

  return [
    'Connection',
    `  ${server}`,
    `  Token ${token} · ${version}`,
    '',
    'Runtimes',
    `  ${detected} detected · ${installed}/${ALL_CHANNELS.length} integrations installed`,
    needsAttention ? `  ${needsAttention} need attention` : '  All installed integrations look healthy',
    '',
    'Full details: loremem status',
  ].join('\n');
}

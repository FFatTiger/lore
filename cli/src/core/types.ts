export type ChannelId =
  | 'claudecode'
  | 'codex'
  | 'pi'
  | 'openclaw'
  | 'hermes'
  | 'opencode'
  | 'zcode';

export const ALL_CHANNELS: ChannelId[] = [
  'claudecode',
  'codex',
  'pi',
  'openclaw',
  'hermes',
  'opencode',
  'zcode',
];

export type NeedInstall = 0 | 1 | 2;
export type Lang = 'en' | 'zh';
export type ConnectionMode = 'preserve' | 'docker' | 'external';
export type TokenAction = 'keep' | 'set' | 'clear';
export type InstallOperation = 'install' | 'update';

export type LoreConfig = {
  base_url?: string;
  api_token?: string;
  installed_version?: string;
  docker_managed?: boolean;
  server_profile?: {
    base_url: string;
    edition?: string;
    capabilities: Record<string, boolean>;
  };
};

export type ChannelResult = {
  id: ChannelId;
  status: 'ok' | 'skipped' | 'failed';
  message?: string;
};

export type ChannelStatus = {
  id: ChannelId;
  state: 'installed' | 'missing' | 'partial' | 'unknown';
  details: string[];
};

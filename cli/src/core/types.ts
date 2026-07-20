export type ChannelId =
  | 'claudecode'
  | 'codex'
  | 'pi'
  | 'openclaw'
  | 'hermes'
  | 'opencode';

export const ALL_CHANNELS: ChannelId[] = [
  'claudecode',
  'codex',
  'pi',
  'openclaw',
  'hermes',
  'opencode',
];

export type NeedInstall = 0 | 1 | 2;
export type Lang = 'en' | 'zh';

export type LoreConfig = {
  base_url?: string;
  api_token?: string;
  installed_version?: string;
  docker_managed?: boolean;
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

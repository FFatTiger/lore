import type { ChannelId, ChannelResult, ChannelStatus, Lang, NeedInstall, TokenAction } from '../core/types.js';
import type { ExecFn } from '../core/exec.js';

export type ChannelContext = {
  loreHome: string;
  baseUrl: string;
  apiToken?: string;
  tokenAction: TokenAction;
  releaseVersion?: string;
  needInstall: NeedInstall;
  force: boolean;
  lang: Lang;
  /** Environment propagated to host-specific helpers. */
  env?: NodeJS.ProcessEnv;
  /** Injectable command runner for host CLI operations (default: createExec). */
  run?: ExecFn;
  /** Injectable artifact runner for curl/unzip compatibility tests. Production uses Node fetch + ZIP extraction. */
  artifactRun?: ExecFn;
  /** Override home directory for tests (default: os.homedir()). */
  homeDir?: string;
};

export type UninstallContext = {
  loreHome: string;
  homeDir?: string;
  run?: ExecFn;
  purgeRelated?: boolean;
};

export type ChannelInstaller = {
  id: ChannelId;
  detectCli(): Promise<boolean>;
  install(ctx: ChannelContext): Promise<ChannelResult>;
  uninstall(ctx: UninstallContext): Promise<ChannelResult>;
  status(ctx?: { loreHome?: string; homeDir?: string }): Promise<ChannelStatus>;
};

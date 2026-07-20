import { ALL_CHANNELS } from '../core/types.js';
import type { GlobalArgs } from '../core/args.js';
import { getConfigPath, getLoreHome } from '../core/paths.js';
import { readConfig } from '../core/config.js';
import { detectAgents } from '../core/detect.js';
import { getInstaller } from '../channels/registry.js';
import { createLogger } from '../ui/log.js';

export type StatusDeps = {
  env?: NodeJS.ProcessEnv;
  log?: ReturnType<typeof createLogger>;
};

export async function runStatus(_args: GlobalArgs, deps: StatusDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? createLogger();
  const loreHome = getLoreHome(env);
  const configPath = getConfigPath(loreHome);
  const cfg = await readConfig(configPath);
  const agents = await detectAgents();

  log.section('config');
  log.info(`path: ${configPath}`);
  log.info(`base_url: ${cfg.base_url ?? '(unset)'}`);
  log.info(`installed_version: ${cfg.installed_version ?? '(unset)'}`);
  log.info(`docker_managed: ${String(cfg.docker_managed ?? false)}`);
  log.info(`api_token: ${cfg.api_token ? 'set' : 'absent'}`);

  log.section('detected CLIs');
  for (const [name, present] of Object.entries(agents)) {
    log.info(`${name}: ${present ? 'yes' : 'no'}`);
  }

  log.section('channels');
  for (const id of ALL_CHANNELS) {
    try {
      const st = await getInstaller(id).status({ loreHome, homeDir: env.HOME });
      log.info(`${id}: ${st.state}${st.details.length ? ` (${st.details.join(', ')})` : ''}`);
    } catch (err) {
      log.warn(`${id}: unknown (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  return 0;
}

import { parseArgv } from './core/args.js';
import { runInstall, runUpdate } from './commands/install.js';
import { runUninstall } from './commands/uninstall.js';
import { runStatus } from './commands/status.js';

const USAGE = `Usage: npx @loremem/cli <install|update|uninstall|status> [options]

Commands:
  install (connect)  Install or connect Lore to agent runtimes
  update             Update Lore server artifacts and channel integrations
  uninstall          Remove Lore integrations
  status             Show local Lore install status

Common flags:
  --base-url URL       External/SaaS Lore server (skips Docker)
  --api-token TOKEN    API token written to ~/.lore/config.json
  --channels LIST      claudecode,codex,pi,openclaw,hermes,opencode
  --skip-docker        Do not manage Docker
  --force              Reinstall even if version unchanged
  --pre | --dev        Release channel
  --lang en|zh
  --purge              Uninstall only: remove config + docker data
  -y, --yes            Skip confirmations
  -h, --help

Primary invocation: npx @loremem/cli`;

export async function run(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgv(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    console.error(USAGE);
    return 2;
  }

  if (args.help || args.command === 'help') {
    console.log(USAGE);
    return 0;
  }

  switch (args.command) {
    case 'install':
      return runInstall(args);
    case 'update':
      return runUpdate(args);
    case 'uninstall':
      return runUninstall(args);
    case 'status':
      return runStatus(args);
    default:
      console.error('Not implemented');
      return 1;
  }
}

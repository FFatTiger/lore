import { parseArgv } from './core/args.js';

const USAGE = `Usage: npx @loremem/cli <install|update|uninstall|status> [options]

Commands:
  install (connect)  Install or connect Lore to agent runtimes
  update             Update Lore server artifacts and channel integrations
  uninstall          Remove Lore integrations
  status             Show local Lore install status

Run a command with --help for flags.`;

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

  console.error('Not implemented');
  return 1;
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(`Usage: npx @loremem/cli <install|update|uninstall|status> [options]

Commands:
  install (connect)  Install or connect Lore to agent runtimes
  update             Update Lore server artifacts and channel integrations
  uninstall          Remove Lore integrations
  status             Show local Lore install status

Run a command with --help for flags.`);
    return 0;
  }
  console.error('Not implemented');
  return 1;
}

import { ALL_CHANNELS, type ChannelId } from '../core/types.js';
import type { GlobalArgs } from '../core/args.js';
import { getConfigPath, getLoreHome, dockerDir } from '../core/paths.js';
import { createExec, type ExecFn } from '../core/exec.js';
import { getInstaller } from '../channels/registry.js';
import { createLogger } from '../ui/log.js';
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export type UninstallDeps = {
  env?: NodeJS.ProcessEnv;
  run?: ExecFn;
  isTTY?: boolean;
  log?: ReturnType<typeof createLogger>;
  confirm?: (message: string) => Promise<boolean>;
};

export async function runUninstall(args: GlobalArgs, deps: UninstallDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const run = deps.run ?? createExec();
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const log = deps.log ?? createLogger();
  const loreHome = getLoreHome(env);
  const channels: ChannelId[] = args.channels?.length ? args.channels : [...ALL_CHANNELS];

  const confirm =
    deps.confirm ??
    (async (message: string) => {
      if (args.yes || !isTTY) return true;
      const rl = readline.createInterface({ input, output });
      try {
        const answer = await rl.question(`${message} [y/N]: `);
        return /^y(es)?$/i.test(answer.trim());
      } finally {
        rl.close();
      }
    });

  log.info(`Channels: ${channels.join(', ')}`);
  if (args.purge) log.warn('--purge: will remove config + Docker data');
  const ok = await confirm('Uninstall these channels?');
  if (!ok) {
    log.err('Aborted.');
    return 1;
  }

  let anyFailed = false;
  for (const id of channels) {
    log.section(id);
    try {
      const result = await getInstaller(id).uninstall({
        loreHome,
        homeDir: env.HOME,
        run,
      });
      if (result.status === 'failed') {
        anyFailed = true;
        log.err(result.message ?? `${id} failed`);
      } else {
        log.ok(result.message ?? `${id} removed`);
      }
    } catch (err) {
      anyFailed = true;
      log.err(err instanceof Error ? err.message : String(err));
    }
  }

  if (args.purge) {
    log.section('purge');
    await fs.rm(getConfigPath(loreHome), { force: true }).catch(() => undefined);
    await fs.rm(dockerDir(loreHome), { recursive: true, force: true }).catch(() => undefined);
    try {
      const left = await fs.readdir(loreHome);
      if (left.length === 0) await fs.rmdir(loreHome);
    } catch {
      // ignore
    }
    log.ok('Purged shared resources');
  }

  return anyFailed ? 1 : 0;
}

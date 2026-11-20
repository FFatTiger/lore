import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { downloadOrSkipDetailed } from '../core/artifact.js';
import { haveCommand } from '../core/detect.js';
import { createExec, runChecked } from '../core/exec.js';
import { channelDir } from '../core/paths.js';
import type { ChannelResult } from '../core/types.js';
import type { ChannelInstaller } from './types.js';

type ObjectMap = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectMap => value !== null && typeof value === 'object' && !Array.isArray(value);
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const failure = (error: unknown): ChannelResult => ({ id: 'agy', status: 'failed', message: error instanceof Error ? error.message : String(error) });

async function readOptional(file: string): Promise<string | undefined> {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (isMissing(error)) return undefined; throw error; }
}

async function cleanLegacy(loreHome: string, homeDir: string): Promise<boolean> {
  const receiptFile = path.join(channelDir(loreHome, 'agy'), 'receipt.json');
  const rawReceipt = await readOptional(receiptFile);
  if (rawReceipt === undefined) return false;
  const receipt: unknown = JSON.parse(rawReceipt);
  if (!isObject(receipt) || receipt.version !== 1 || !isObject(receipt.entry)) throw new Error(`Invalid agy ownership receipt: ${receiptFile}`);
  const configFile = path.join(homeDir, '.gemini', 'config', 'mcp_config.json');
  const raw = await readOptional(configFile);
  if (raw === undefined) return true;
  const config: unknown = JSON.parse(raw);
  if (!isObject(config) || ('mcpServers' in config && !isObject(config.mcpServers))) throw new Error(`Invalid MCP config shape: ${configFile}`);
  const servers = config.mcpServers;
  if (!isObject(servers) || !isDeepStrictEqual(servers.lore, receipt.entry)) return true;
  const st = await fs.lstat(configFile);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error(`Unsafe file: ${configFile}`);
  delete servers.lore;
  const temp = `${configFile}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: st.mode & 0o777 });
    if (await fs.readFile(configFile, 'utf8') !== raw) throw new Error('Antigravity MCP config changed during migration; retry');
    await fs.rename(temp, configFile);
  } finally { await fs.rm(temp, { force: true }); }
  return true;
}

export const agyInstaller: ChannelInstaller = {
  id: 'agy',
  async detectCli() { return haveCommand('agy'); },
  async install(ctx) {
    if (!(await haveCommand('agy', ctx.env ?? process.env))) return { id: 'agy', status: 'skipped', message: 'Antigravity CLI (agy) not found on PATH' };
    try {
      const dest = channelDir(ctx.loreHome, 'agy');
      const legacy = await cleanLegacy(ctx.loreHome, ctx.homeDir ?? os.homedir());
      const download = await downloadOrSkipDetailed({
        channel: 'agy', dest, releaseVersion: ctx.releaseVersion,
        needInstall: legacy ? 0 : ctx.needInstall, run: ctx.artifactRun,
      });
      if (!download.ok) return { id: 'agy', status: 'failed', message: download.reason ?? 'Antigravity artifact download failed' };
      const run = ctx.run ?? createExec();
      const options = { quiet: true, env: ctx.env ?? process.env };
      await run(['agy', 'plugin', 'uninstall', 'lore'], options).catch(() => undefined);
      await runChecked(run, 'Antigravity plugin installation', ['agy', 'plugin', 'install', dest], options, { redact: [ctx.apiToken ?? ''] });
      await runChecked(run, 'Antigravity plugin enable', ['agy', 'plugin', 'enable', 'lore'], options, { redact: [ctx.apiToken ?? ''] });
      return { id: 'agy', status: 'ok', message: 'Antigravity CLI plugin configured' };
    } catch (error) { return failure(error); }
  },
  async uninstall(ctx) {
    try {
      if (await haveCommand('agy')) await (ctx.run ?? createExec())(['agy', 'plugin', 'uninstall', 'lore'], { quiet: true }).catch(() => undefined);
      await cleanLegacy(ctx.loreHome, ctx.homeDir ?? os.homedir());
      await fs.rm(channelDir(ctx.loreHome, 'agy'), { recursive: true, force: true });
      return { id: 'agy', status: 'ok', message: 'Antigravity CLI plugin uninstall complete' };
    } catch (error) { return failure(error); }
  },
  async status(ctx = {}) {
    const home = ctx.homeDir ?? os.homedir();
    const dest = channelDir(ctx.loreHome ?? path.join(home, '.lore'), 'agy');
    const installed = path.join(home, '.gemini', 'config', 'plugins', 'lore', 'plugin.json');
    try { await fs.access(installed); return { id: 'agy', state: 'installed', details: [installed] }; }
    catch {
      try { await fs.access(dest); return { id: 'agy', state: 'partial', details: [dest] }; }
      catch { return { id: 'agy', state: 'missing', details: [] }; }
    }
  },
};

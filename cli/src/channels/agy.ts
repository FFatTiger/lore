import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { haveCommand } from '../core/detect.js';
import type { ChannelResult } from '../core/types.js';
import type { ChannelInstaller } from './types.js';

type ObjectMap = Record<string, unknown>;
type Receipt = { version: 1; entry: ObjectMap; pending?: ObjectMap };
const ENTRY = "import { runLoreMcpBridge } from './mcp-bridge/index.mjs';\nrunLoreMcpBridge({ clientType: 'mcp', redirect: 'error' });\n";
const FILES = ['lore-mcp.mjs', 'lore-config.mjs', 'mcp-bridge/index.mjs'];
const vendor = fileURLToPath(new URL('../../vendor/', import.meta.url));
const object = (value: unknown): value is ObjectMap => value !== null && typeof value === 'object' && !Array.isArray(value);
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

// Refuse symlinks and unexpected file types in installer-managed paths.
async function check(target: string, directory = false): Promise<boolean> {
  try {
    const st = await fs.lstat(target);
    if (st.isSymbolicLink() || !(directory ? st.isDirectory() : st.isFile())) {
      throw new Error(`Unsafe ${directory ? 'directory' : 'file'}: ${target}`);
    }
    return true;
  } catch (error) {
    if (absent(error)) return false;
    throw error;
  }
}

function paths(ctx: { loreHome?: string; homeDir?: string }) {
  const home = path.resolve(ctx.homeDir ?? os.homedir());
  const loreHome = path.resolve(ctx.loreHome ?? path.join(home, '.lore'));
  const dest = path.join(loreHome, 'agy');
  const configDir = path.join(home, '.gemini', 'config');
  return { home, loreHome, dest, configDir, config: path.join(configDir, 'mcp_config.json'), receipt: path.join(dest, 'receipt.json') };
}

async function inspect(p: ReturnType<typeof paths>) {
  const checked = new Set<string>();
  async function checkDirectory(dir: string): Promise<void> {
    if (checked.has(dir)) return;
    const parent = path.dirname(dir);
    if (parent !== dir) await checkDirectory(parent);
    await check(dir, true);
    checked.add(dir);
  }
  await checkDirectory(p.configDir);
  await checkDirectory(path.join(p.dest, 'mcp-bridge'));
  const raw = await check(p.config) ? await fs.readFile(p.config, 'utf8') : '';
  // Only a genuinely zero-byte scaffold is accepted, not whitespace or malformed JSON.
  const config: unknown = raw === '' ? {} : JSON.parse(raw);
  if (!object(config) || ('mcpServers' in config && !object(config.mcpServers))) {
    throw new Error(`Invalid MCP config shape: ${p.config}`);
  }
  const servers = (config.mcpServers ?? {}) as ObjectMap;
  let receipt: Receipt | undefined;
  if (await check(p.receipt)) {
    const parsed: unknown = JSON.parse(await fs.readFile(p.receipt, 'utf8'));
    if (!object(parsed) || parsed.version !== 1 || !object(parsed.entry) || ('pending' in parsed && !object(parsed.pending))) {
      throw new Error(`Invalid agy ownership receipt: ${p.receipt}`);
    }
    receipt = parsed as Receipt;
  }
  return { config, servers, receipt, raw };
}

function owns(entry: unknown, receipt?: Receipt): boolean {
  return Boolean(receipt && (isDeepStrictEqual(entry, receipt.entry) || (receipt.pending && isDeepStrictEqual(entry, receipt.pending))));
}

async function atomic(file: string, content: string): Promise<void> {
  await check(file);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, content, { flag: 'wx', mode: 0o600 });
    await check(file);
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const failure = (error: unknown): ChannelResult => ({ id: 'agy', status: 'failed', message: error instanceof Error ? error.message : String(error) });

async function writeConfig(p: ReturnType<typeof paths>, previous: Awaited<ReturnType<typeof inspect>>) {
  // Do not overwrite an edit made while staging the bridge/receipt.
  await check(p.config);
  const current = await fs.readFile(p.config, 'utf8').catch((error) => { if (absent(error)) return ''; throw error; });
  if (current !== previous.raw) throw new Error('Antigravity MCP config changed during installation; retry');
  await atomic(p.config, json(previous.config));
}

export const agyInstaller: ChannelInstaller = {
  id: 'agy',
  async detectCli() { return haveCommand('agy'); },
  async install(ctx) {
    if (!(await haveCommand('agy', ctx.env ?? process.env))) return { id: 'agy', status: 'skipped', message: 'Antigravity CLI (agy) not found on PATH' };
    try {
      const p = paths(ctx);
      const state = await inspect(p);
      if ('lore' in state.servers && !owns(state.servers.lore, state.receipt)) {
        throw new Error('Antigravity lore registration is unowned or user-modified; leaving registration and bridge files untouched');
      }
      // Validate every destination before changing anything (including on update).
      for (const file of FILES) await check(path.join(p.dest, file));
      const sources = await Promise.all(['lore-config.mjs', 'mcp-bridge/index.mjs'].map((file) => fs.readFile(path.join(vendor, file), 'utf8')));
      const entry = { command: process.execPath, args: [path.join(p.dest, 'lore-mcp.mjs')], env: { LORE_HOME: p.loreHome, LORE_SKILLS_ENABLED: '0' } };
      await fs.mkdir(path.join(p.dest, 'mcp-bridge'), { recursive: true });
      await fs.mkdir(p.configDir, { recursive: true });
      // Persist intent BEFORE staging or registering. Both old and intended entries
      // are recognized after interruption; a user-modified entry never is.
      await atomic(p.receipt, json({ version: 1, entry: state.servers.lore ?? state.receipt?.entry ?? entry, pending: entry }));
      for (const [i, file] of FILES.entries()) await atomic(path.join(p.dest, file), [ENTRY, ...sources][i]);
      state.servers.lore = entry;
      state.config.mcpServers = state.servers;
      await writeConfig(p, state);
      await atomic(p.receipt, json({ version: 1, entry }));
      return { id: 'agy', status: 'ok', message: `Antigravity MCP configured (memory only): ${p.config}` };
    } catch (error) { return failure(error); }
  },
  async uninstall(ctx) {
    try {
      const p = paths(ctx);
      const state = await inspect(p);
      if ('lore' in state.servers) {
        if (!owns(state.servers.lore, state.receipt)) throw new Error('Antigravity lore registration is unowned or user-modified; leaving registration and bridge files untouched');
        delete state.servers.lore;
        await writeConfig(p, state);
      }
      if (state.receipt) await fs.rm(p.dest, { recursive: true, force: true });
      return { id: 'agy', status: 'ok', message: 'Antigravity MCP uninstall complete' };
    } catch (error) { return failure(error); }
  },
  async status(ctx = {}) {
    const p = paths(ctx);
    try {
      const state = await inspect(p);
      const hasDir = await check(p.dest, true);
      const expected = [ENTRY, ...await Promise.all(['lore-config.mjs', 'mcp-bridge/index.mjs'].map((file) => fs.readFile(path.join(vendor, file), 'utf8')))];
      const present = await Promise.all(FILES.map(async (file, index) => {
        const target = path.join(p.dest, file);
        return await check(target) && (await fs.readFile(target, 'utf8')) === expected[index];
      }));
      const installed = owns(state.servers.lore, state.receipt) && !state.receipt?.pending && present.every(Boolean);
      return { id: 'agy', state: installed ? 'installed' : hasDir || 'lore' in state.servers ? 'partial' : 'missing', details: installed ? [p.config, p.dest] : hasDir || 'lore' in state.servers ? ['Registration or bridge incomplete, unowned, or modified', p.config, p.dest] : [] };
    } catch (error) {
      return { id: 'agy', state: 'unknown', details: [error instanceof Error ? error.message : String(error)] };
    }
  },
};

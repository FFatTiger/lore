import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  dshInstaller,
  dshHomeDir,
  removeManagedPatch,
  renderLoreRows,
  upsertManagedPatch,
} from '../src/channels/dsh.ts';
import { getInstaller, allInstallers } from '../src/channels/registry.ts';
import type { ChannelContext } from '../src/channels/types.ts';

async function tempHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-dsh-'));
  const loreHome = path.join(home, '.lore');
  await fs.mkdir(loreHome, { recursive: true });
  return { home, loreHome };
}

function ctx(p: Partial<ChannelContext> & { loreHome: string; homeDir: string }): ChannelContext {
  return {
    baseUrl: 'https://core.example',
    apiToken: 'lm_x',
    tokenAction: 'set',
    needInstall: 2,
    capabilities: { skills: true },
    force: false,
    lang: 'en',
    releaseVersion: 'v1.10.0',
    env: { ...process.env, DSH_HOME: path.join(p.homeDir, '.dsh') },
    ...p,
  };
}

async function seedArtifact(loreHome: string): Promise<string> {
  const dest = path.join(loreHome, 'dsh');
  await fs.mkdir(path.join(dest, 'plugin'), { recursive: true });
  await fs.mkdir(path.join(dest, 'mcp'), { recursive: true });
  await fs.mkdir(path.join(dest, '.dsh-plugin'), { recursive: true });
  await fs.writeFile(path.join(dest, '.lore-release'), 'v1.10.0\n');
  await fs.writeFile(path.join(dest, '.dsh-plugin', 'plugin.json'), JSON.stringify({ name: 'lore', version: '1.10.0' }));
  await fs.writeFile(path.join(dest, 'plugin', 'lifecycle.mjs'), 'export const name = "lore-lifecycle";\n');
  await fs.writeFile(path.join(dest, 'mcp', 'lore-mcp.mjs'), 'export {};\n');
  return dest;
}

function patchFile(home: string): string {
  return path.join(dshHomeDir({ DSH_HOME: path.join(home, '.dsh') }), 'cordis.patch.yml');
}

test('registry lists dsh', () => {
  const ids = allInstallers().map((i) => i.id);
  assert.ok(ids.includes('dsh'));
  assert.equal(getInstaller('dsh').id, 'dsh');
});

test('renderLoreRows quotes paths as YAML double-quoted scalars', () => {
  const plain = renderLoreRows({ pluginPath: '/a/lifecycle.mjs', bridgePath: '/a/lore-mcp.mjs' });
  assert.ok(plain.includes('name: "/a/lifecycle.mjs"'));
  assert.ok(plain.includes('          - "/a/lore-mcp.mjs"'));

  const tricky = renderLoreRows({ pluginPath: '/opt/my lore:a#b/lifecycle.mjs', bridgePath: '/opt/my lore:a#b/lore-mcp.mjs' });
  assert.ok(tricky.includes('name: "/opt/my lore:a#b/lifecycle.mjs"'));
  assert.ok(tricky.includes('          - "/opt/my lore:a#b/lore-mcp.mjs"'));
});

test('upsertManagedPatch replaces only the managed block and preserves user rows and comments', () => {
  const block = renderLoreRows({ pluginPath: '/a/lifecycle.mjs', bridgePath: '/a/lore-mcp.mjs' });
  const userFile = [
    '# my dsh home patch',
    '- insert:',
    '    - id: my-tool',
    `      name: '@deepseek-ai/dsh-mcp-client'`,
    '      config:',
    '        serverName: mine',
  ].join('\n');

  const first = upsertManagedPatch(userFile, block);
  assert.ok(first.includes('# my dsh home patch'));
  assert.ok(first.includes('- id: my-tool'));
  assert.ok(first.includes('# >>> lore (managed) >>>'));
  assert.ok(first.includes('- id: lore-lifecycle'));

  const moved = renderLoreRows({ pluginPath: '/b/lifecycle.mjs', bridgePath: '/b/lore-mcp.mjs' });
  const second = upsertManagedPatch(first, moved);
  assert.ok(second.includes('/b/lifecycle.mjs'));
  assert.ok(!second.includes('/a/lifecycle.mjs'));
  assert.equal(second.match(/# >>> lore \(managed\) >>>/g)?.length, 1);
  assert.ok(second.includes('- id: my-tool'));

  const removed = removeManagedPatch(second);
  assert.ok(removed.includes('- id: my-tool'));
  assert.ok(!removed.includes('lore-lifecycle'));
  assert.ok(!removed.includes('# >>> lore (managed) >>>'));
});

test('upsertManagedPatch handles missing and placeholder files', () => {
  const block = renderLoreRows({ pluginPath: '/a/lifecycle.mjs', bridgePath: '/a/lore-mcp.mjs' });
  assert.equal(upsertManagedPatch(null, block), `# >>> lore (managed) >>>\n${block}\n# <<< lore (managed) <<<\n`);

  const placeholder = `# template header\n[]`;
  const upserted = upsertManagedPatch(placeholder, block);
  assert.ok(upserted.includes('# template header'));
  assert.ok(!upserted.includes('[]'));
  assert.ok(upserted.includes('- id: lore-lifecycle'));

  const emptied = removeManagedPatch(upserted);
  assert.ok(emptied.includes('# template header'));
  assert.ok(emptied.trim().endsWith('[]'));
});

test('dsh skips when no binary and no dsh home exist', async () => {
  const { home, loreHome } = await tempHome();
  const emptyBin = path.join(home, 'empty-bin');
  await fs.mkdir(emptyBin, { recursive: true });
  const originalPath = process.env.PATH;
  process.env.PATH = emptyBin;
  try {
    const result = await dshInstaller.install(ctx({ loreHome, homeDir: home }));
    assert.equal(result.status, 'skipped');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('dsh install is detected through an existing dsh home without a binary', async () => {
  const { home, loreHome } = await tempHome();
  await seedArtifact(loreHome);
  await fs.mkdir(path.join(home, '.dsh'), { recursive: true });
  const emptyBin = path.join(home, 'empty-bin');
  await fs.mkdir(emptyBin, { recursive: true });
  const originalPath = process.env.PATH;
  process.env.PATH = emptyBin;
  try {
    const result = await dshInstaller.install(ctx({ loreHome, homeDir: home }));
    assert.equal(result.status, 'ok');
    const content = await fs.readFile(patchFile(home), 'utf8');
    assert.ok(content.includes(`name: ${JSON.stringify(path.join(loreHome, 'dsh', 'plugin', 'lifecycle.mjs'))}`));
    assert.ok(content.includes(`- ${JSON.stringify(path.join(loreHome, 'dsh', 'mcp', 'lore-mcp.mjs'))}`));
    assert.ok(!content.includes('lm_x'));
  } finally {
    process.env.PATH = originalPath;
  }
});

test('dsh install writes lore rows into the home patch and keeps a backup', async () => {
  const { home, loreHome } = await tempHome();
  const dest = await seedArtifact(loreHome);
  const dshHome = path.join(home, '.dsh');
  await fs.mkdir(dshHome, { recursive: true });
  await fs.writeFile(patchFile(home), [
    '# existing rows',
    '- insert:',
    '    - id: user-row',
    '      name: ./user-plugin.mjs',
    '',
  ].join('\n'));

  const result = await dshInstaller.install(ctx({ loreHome, homeDir: home }));
  assert.equal(result.status, 'ok');

  const content = await fs.readFile(patchFile(home), 'utf8');
  assert.ok(content.includes('- id: user-row'));
  assert.ok(content.includes('- id: lore-lifecycle'));
  assert.ok(content.includes(`name: '@deepseek-ai/dsh-mcp-client'`));
  assert.ok(content.includes('serverName: lore'));
  const backup = await fs.readFile(path.join(dshHome, 'cordis.patch.yml.lore-bak'), 'utf8');
  assert.ok(backup.includes('- id: user-row'));
  assert.ok(!backup.includes('lore-lifecycle'));

  // Re-install replaces only our rows, even when the artifact path moved.
  const movedHome = path.join(home, 'moved');
  await fs.mkdir(movedHome, { recursive: true });
  const reinstalled = await dshInstaller.install(ctx({ loreHome, homeDir: home }));
  assert.equal(reinstalled.status, 'ok');
  const again = await fs.readFile(patchFile(home), 'utf8');
  assert.equal(again.match(/- id: lore-lifecycle/g)?.length, 1);
  assert.equal(again.match(/- id: user-row/g)?.length, 1);
  assert.ok(again.includes(JSON.stringify(path.join(dest, 'plugin', 'lifecycle.mjs'))));
  assert.ok(!again.includes('lm_x'));
});

test('dsh install fails when the artifact is incomplete', async () => {
  const { home, loreHome } = await tempHome();
  const dest = await seedArtifact(loreHome);
  await fs.rm(path.join(dest, 'plugin', 'lifecycle.mjs'));
  await fs.mkdir(path.join(home, '.dsh'), { recursive: true });
  const result = await dshInstaller.install(ctx({ loreHome, homeDir: home }));
  assert.equal(result.status, 'failed');
});

test('dsh uninstall removes lore rows and channel dir but preserves user rows', async () => {
  const { home, loreHome } = await tempHome();
  await seedArtifact(loreHome);
  await fs.mkdir(path.join(home, '.dsh'), { recursive: true });
  await dshInstaller.install(ctx({ loreHome, homeDir: home }));
  await fs.appendFile(patchFile(home), '- insert:\n    - id: user-row\n      name: ./user-plugin.mjs\n');

  const result = await dshInstaller.uninstall({ loreHome, homeDir: home });
  assert.equal(result.status, 'ok');
  const content = await fs.readFile(patchFile(home), 'utf8');
  assert.ok(content.includes('- id: user-row'));
  assert.ok(!content.includes('lore-lifecycle'));
  await assert.rejects(fs.access(path.join(loreHome, 'dsh')));

  const status = await dshInstaller.status({ loreHome, homeDir: home });
  assert.equal(status.state, 'missing');
});

test('dsh status distinguishes installed and partial states', async () => {
  const { home, loreHome } = await tempHome();
  await seedArtifact(loreHome);
  await fs.mkdir(path.join(home, '.dsh'), { recursive: true });

  assert.equal((await dshInstaller.status({ loreHome, homeDir: home })).state, 'partial');
  await dshInstaller.install(ctx({ loreHome, homeDir: home }));
  const installed = await dshInstaller.status({ loreHome, homeDir: home });
  assert.equal(installed.state, 'installed');
  assert.equal(installed.details.length, 2);
});

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(root);
const archivePath = join(repositoryRoot, 'dist/lore-opencode.zip');
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string;

function archiveEntries(): string[] {
  const output = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' });
  return output.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

describe('OpenCode release bundle', () => {
  it('builds one managed ESM file without development paths or secrets', () => {
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
    const output = readFileSync(join(root, 'dist/lore-memory.js'), 'utf8');
    expect(output).toContain('@lore-managed-opencode-plugin');
    expect(output).toContain(`version=${packageVersion}`);
    expect(output).toContain('ensureSkillWorkCopy');
    expect(output).toContain('lore.skill.workcopy.v1');
    expect(output).toContain('lore_skill_get');
    // Vendor work-copy is inlined into the single managed ESM file (esbuild may keep a path comment).
    expect(output).not.toMatch(/from ['"].*vendor\/skill-workcopy/);
    expect(output).not.toMatch(/require\(['"].*vendor\/skill-workcopy/);
    expect(output).not.toContain('/Users/proxy/');
    expect(output).not.toContain('LORE_API_TOKEN=');
  });

  it('builds the exact release archive layout without secrets or development paths', () => {
    execFileSync('bash', [resolve(repositoryRoot, 'scripts/build-opencode-artifact.sh')], {
      cwd: repositoryRoot,
      stdio: 'pipe',
    });

    expect(archiveEntries()).toEqual([
      'lore-memory.js',
      'README.md',
      'THIRD_PARTY_NOTICES.md',
    ]);

    for (const entry of archiveEntries()) {
      expect(entry).not.toMatch(/(?:^|\/)node_modules\//);
      expect(entry).not.toMatch(/(?:^|\/)coverage\//);
      expect(entry).not.toMatch(/(?:^|\/)\.vitest\//);
      expect(entry).not.toMatch(/(?:^|\/)\.DS_Store$/);
      expect(entry).not.toMatch(/(?:^|\/)\.env(?:$|\.)/);
      expect(entry).not.toMatch(/\.log$/);
    }

    for (const entry of archiveEntries()) {
      const content = execFileSync('unzip', ['-p', archivePath, entry], { encoding: 'utf8' });
      expect(content).not.toContain('/Users/');
      expect(content).not.toContain('/home/');
      expect(content).not.toContain('LORE_API_TOKEN=');
      expect(content).not.toMatch(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]{12,}/);
    }
  });
});

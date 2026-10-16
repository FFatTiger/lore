import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(pluginRoot);
const docs = 'docs/website/content/documents';

const englishFiles = ['README.md', `${docs}/agents/opencode.mdx`, `${docs}/troubleshooting/agents.mdx`] as const;
const chineseFiles = ['README.zh-CN.md', `${docs}/agents/opencode.zh-cn.mdx`, `${docs}/troubleshooting/agents.zh-cn.mdx`] as const;

function read(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

// The OpenCode install contract every language must keep documenting.
const contract = ['--channels opencode', 'lore-opencode.zip', 'plugins/lore-memory.js', 'LORE_OPENCODE_ALLOW_MCP'];

describe('OpenCode documentation', () => {
  it.each([...englishFiles, ...chineseFiles])('%s mentions OpenCode', (path) => {
    expect(read(path)).toContain('OpenCode');
  });

  it.each([
    ['English', englishFiles],
    ['Chinese', chineseFiles],
  ] as const)('%s docs cover the install contract', (_lang, files) => {
    const content = files.map(read).join('\n\n');
    for (const required of contract) {
      expect(content).toContain(required);
    }
  });
});

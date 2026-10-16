import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: [fileURLToPath(new URL('../index.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/lore-memory.js', import.meta.url)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js: [
      `/* @lore-managed-opencode-plugin version=${pkg.version} */`,
      `globalThis.__LORE_PLUGIN_VERSION__ = ${JSON.stringify(pkg.version)};`,
    ].join('\n'),
  },
});

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: ROOT,
  resolve: {
    alias: {
      '@': path.resolve(ROOT),
      '@base-ui/react/merge-props': path.resolve(ROOT, 'node_modules/@base-ui/react/merge-props/index.js'),
    },
  },
  test: {
    environment: 'node',
    server: {
      deps: {
        inline: ['@lobehub/ui'],
      },
    },
  },
});

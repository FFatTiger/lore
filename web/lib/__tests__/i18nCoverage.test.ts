import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasTranslation } from '../i18n';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_DIRS = ['app', 'components', 'lib'];
const T_CALL = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*[,)]/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__' || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

describe('i18n coverage', () => {
  it('has a Chinese translation for every literal t() key in the web UI', () => {
    const missing: string[] = [];
    for (const file of SOURCE_DIRS.flatMap((dir) => sourceFiles(path.join(WEB_ROOT, dir)))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(T_CALL)) {
        const key = match[2].replace(/\\(['"\\])/g, '$1');
        if (!hasTranslation(key)) {
          const line = source.slice(0, match.index).split('\n').length;
          missing.push(`${path.relative(WEB_ROOT, file)}:${line} ${JSON.stringify(key)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

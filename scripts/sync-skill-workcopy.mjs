#!/usr/bin/env node
/**
 * Sync shared/skill-workcopy/* into plugin vendor directories as byte-identical copies.
 *
 * Usage:
 *   node scripts/sync-skill-workcopy.mjs          # write vendor copies
 *   node scripts/sync-skill-workcopy.mjs --check  # exit 1 if any vendor copy drifts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const SOURCE_DIR = path.join(REPO_ROOT, 'shared', 'skill-workcopy');
const SOURCE_FILES = ['index.mjs', 'index.d.mts'];

const VENDOR_TARGETS = [
  'pi-extension/vendor/skill-workcopy',
  'openclaw-plugin/vendor/skill-workcopy',
  'opencode-plugin/vendor/skill-workcopy',
];

const EXTRA_VENDOR_TARGETS = [{
  dir: 'local-skills-mcp/vendor',
  files: {
    'skill-workcopy.mjs': 'index.mjs',
    'skill-workcopy.d.mts': 'index.d.mts',
  },
}];

function readSource(name) {
  const full = path.join(SOURCE_DIR, name);
  if (!fs.existsSync(full)) {
    throw new Error(`missing source file: ${full}`);
  }
  return fs.readFileSync(full);
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const sources = Object.fromEntries(SOURCE_FILES.map((name) => [name, readSource(name)]));

  let drift = 0;
  let written = 0;

  for (const rel of VENDOR_TARGETS) {
    const destDir = path.join(REPO_ROOT, rel);
    if (checkOnly) {
      if (!fs.existsSync(destDir)) {
        console.error(`MISSING vendor dir: ${rel}`);
        drift += 1;
        continue;
      }
    } else {
      fs.mkdirSync(destDir, { recursive: true });
    }

    for (const name of SOURCE_FILES) {
      const dest = path.join(destDir, name);
      const expected = sources[name];
      if (checkOnly) {
        if (!fs.existsSync(dest)) {
          console.error(`DRIFT missing: ${path.join(rel, name)}`);
          drift += 1;
          continue;
        }
        const actual = fs.readFileSync(dest);
        if (!actual.equals(expected)) {
          console.error(`DRIFT content: ${path.join(rel, name)}`);
          drift += 1;
        }
      } else {
        fs.writeFileSync(dest, expected);
        written += 1;
        console.log(`wrote ${path.join(rel, name)}`);
      }
    }
  }

  for (const target of EXTRA_VENDOR_TARGETS) {
    const destDir = path.join(REPO_ROOT, target.dir);
    if (!checkOnly) fs.mkdirSync(destDir, { recursive: true });
    for (const [destName, sourceName] of Object.entries(target.files)) {
      const dest = path.join(destDir, destName);
      const expected = sources[sourceName];
      if (checkOnly) {
        if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(expected)) {
          console.error(`DRIFT content: ${path.join(target.dir, destName)}`);
          drift += 1;
        }
      } else {
        fs.writeFileSync(dest, expected);
        written += 1;
        console.log(`wrote ${path.join(target.dir, destName)}`);
      }
    }
  }

  if (checkOnly) {
    if (drift > 0) {
      console.error(`skill-workcopy vendor check failed: ${drift} drift(s)`);
      process.exit(1);
    }
    console.log(`skill-workcopy vendor check ok (${VENDOR_TARGETS.length + EXTRA_VENDOR_TARGETS.length} targets)`);
    return;
  }

  console.log(`skill-workcopy synced: ${written} file(s) → ${VENDOR_TARGETS.length + EXTRA_VENDOR_TARGETS.length} vendor targets`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

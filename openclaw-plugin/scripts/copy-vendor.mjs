/**
 * Copy vendored skill-workcopy into dist so non-bundled esbuild output
 * can resolve ./vendor/skill-workcopy/index.mjs from dist/skills.js.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "vendor", "skill-workcopy");
const dest = path.join(root, "dist", "vendor", "skill-workcopy");

if (!fs.existsSync(src)) {
  console.error(`copy-vendor: missing source ${src}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`copy-vendor: ${src} -> ${dest}`);

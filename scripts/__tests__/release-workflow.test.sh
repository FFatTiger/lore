#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WORKFLOW="$ROOT/.github/workflows/release.yml"
PLUGIN_PACKAGE="$ROOT/opencode-plugin/package.json"
PLUGIN_LOCK="$ROOT/opencode-plugin/package-lock.json"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

grep -Fq 'name: Build OpenCode artifact' "$WORKFLOW" || fail 'OpenCode artifact step missing'
grep -Fq 'cd opencode-plugin' "$WORKFLOW" || fail 'OpenCode package directory missing'
grep -Fq 'npm ci' "$WORKFLOW" || fail 'OpenCode npm ci missing'
grep -Fq 'npm test' "$WORKFLOW" || fail 'OpenCode tests missing'
grep -Fq 'npm run typecheck' "$WORKFLOW" || fail 'OpenCode typecheck missing'
grep -Fq 'bash scripts/build-opencode-artifact.sh' "$WORKFLOW" || fail 'OpenCode artifact builder missing'
grep -Fq 'for f in dist/lore-*.zip' "$WORKFLOW" || fail 'release upload loop missing'

BUILD_LINE=$(grep -n 'name: Build OpenCode artifact' "$WORKFLOW" | cut -d: -f1)
UPLOAD_LINE=$(grep -n 'name: Upload artifacts to release' "$WORKFLOW" | cut -d: -f1)
[[ "$BUILD_LINE" -lt "$UPLOAD_LINE" ]] || fail 'OpenCode artifact must build before upload'

python3 - "$PLUGIN_PACKAGE" "$PLUGIN_LOCK" <<'PY'
import json, sys
package_path, lock_path = sys.argv[1:]
with open(package_path, encoding='utf-8') as handle:
    package = json.load(handle)
with open(lock_path, encoding='utf-8') as handle:
    lock = json.load(handle)

assert package['devDependencies']['esbuild'] == '0.28.1', package['devDependencies']['esbuild']
assert lock['packages']['node_modules/esbuild']['version'] == '0.28.1'
assert 'node_modules/vitest/node_modules/esbuild' not in lock['packages']
assert not any(path.startswith('node_modules/vitest/node_modules/@esbuild/') for path in lock['packages'])
for path, metadata in lock['packages'].items():
    if path.startswith('node_modules/@esbuild/'):
        assert metadata.get('optional') is True, (path, metadata)
PY

echo "release workflow tests passed"

#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/release.sh <version>
#   ./scripts/release.sh --prepare-only <version>
# Example: ./scripts/release.sh --prepare-only 1.3.15-pre.2

PREPARE_ONLY=0
if [[ "${1:-}" == "--prepare-only" ]]; then
  PREPARE_ONLY=1
  shift
fi

VERSION="${1:-}"
if [[ -z "$VERSION" || $# -ne 1 ]]; then
  echo "Usage: $0 [--prepare-only] <version>  (e.g. 1.0.2)"
  exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: '$VERSION' doesn't look like a valid version (expected X.Y.Z)"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ $PREPARE_ONLY -eq 0 ]] && { ! git diff --quiet || ! git diff --cached --quiet; }; then
  echo "Error: working tree not clean. Commit or stash changes first."
  exit 1
fi

SED_INPLACE=(sed -i '')
if [[ "$(uname)" != "Darwin" ]]; then
  SED_INPLACE=(sed -i)
fi

prepare_version() {
  echo "Bumping to v${VERSION}..."

  "${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" web/package.json
  "${SED_INPLACE[@]}" "s/version: '[^']*'/version: '${VERSION}'/" web/server/mcpServer.ts
  "${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" cli/package.json

  "${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" claudecode-plugin/.claude-plugin/plugin.json
  "${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" claudecode-plugin/.claude-plugin/marketplace.json
  "${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" codex-plugin/.codex-plugin/plugin.json
  "${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" openclaw-plugin/openclaw.plugin.json
  "${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" openclaw-plugin/package.json
  "${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" pi-extension/package.json
  "${SED_INPLACE[@]}" "s/^version: .*/version: ${VERSION}/" hermes-plugin/lore_memory/plugin.yaml
  "${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" opencode-plugin/package.json

  python3 - "${VERSION}" \
    web/package-lock.json \
    cli/package-lock.json \
    openclaw-plugin/package-lock.json \
    opencode-plugin/package-lock.json <<'PYLOCK'
import json
import sys
from pathlib import Path

version = sys.argv[1]
for filename in sys.argv[2:]:
    path = Path(filename)
    data = json.loads(path.read_text())
    data["version"] = version
    root = data.get("packages", {}).get("")
    if isinstance(root, dict):
        root["version"] = version
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
PYLOCK
}

verify_versions() {
  echo ""
  echo "Updated files:"
  grep -n "\"version\"" \
    web/package.json \
    web/package-lock.json \
    cli/package.json \
    cli/package-lock.json \
    claudecode-plugin/.claude-plugin/plugin.json \
    claudecode-plugin/.claude-plugin/marketplace.json \
    codex-plugin/.codex-plugin/plugin.json \
    openclaw-plugin/openclaw.plugin.json \
    openclaw-plugin/package.json \
    openclaw-plugin/package-lock.json \
    pi-extension/package.json \
    opencode-plugin/package.json \
    opencode-plugin/package-lock.json
  grep -n "version:" web/server/mcpServer.ts | head -1
  grep -n "version:" hermes-plugin/lore_memory/plugin.yaml | head -1

  python3 - "${VERSION}" cli/package.json cli/package-lock.json opencode-plugin/package.json opencode-plugin/package-lock.json <<'PYVERIFY'
import json
import sys
from pathlib import Path

version, cli_manifest_name, cli_lock_name, manifest_name, lock_name = sys.argv[1:]
cli_manifest = json.loads(Path(cli_manifest_name).read_text())
cli_lock = json.loads(Path(cli_lock_name).read_text())
manifest = json.loads(Path(manifest_name).read_text())
lock = json.loads(Path(lock_name).read_text())
assert cli_manifest["version"] == version
assert cli_lock["version"] == version
assert cli_lock["packages"][""]["version"] == version
assert manifest["version"] == version
assert manifest["dependencies"]["@opencode-ai/plugin"] == "1.18.3"
assert lock["version"] == version
assert lock["packages"][""]["version"] == version
assert lock["packages"][""]["dependencies"]["@opencode-ai/plugin"] == "1.18.3"
assert lock["packages"]["node_modules/@opencode-ai/plugin"]["version"] == "1.18.3"
assert lock["packages"]["node_modules/@opencode-ai/sdk"]["version"] == "1.18.3"
PYVERIFY
  echo ""
}

prepare_version
verify_versions

if [[ $PREPARE_ONLY -eq 1 ]]; then
  echo "Version v${VERSION} prepared, not committed/tagged/pushed."
  exit 0
fi

git add -A
git commit -m "release: v${VERSION}"
git tag "v${VERSION}"
git push
git push --tags

echo ""
echo "Done! v${VERSION} pushed with tag."
echo "GitHub release workflow will build and push fffattiger/lore:latest + fffattiger/lore:${VERSION}"
echo ""
echo "To create GitHub release:"
echo "  gh release create v${VERSION} --title 'v${VERSION}' --generate-notes"

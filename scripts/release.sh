#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 1.0.2

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>  (e.g. 1.0.2)"
  exit 1
fi

# Validate semver-ish format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: '$VERSION' doesn't look like a valid version (expected X.Y.Z)"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Ensure clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree not clean. Commit or stash changes first."
  exit 1
fi

echo "Bumping to v${VERSION}..."

# All files with version to update (sed -i '' for macOS, sed -i for Linux)
SED_INPLACE=(sed -i '')
if [[ "$(uname)" != "Darwin" ]]; then
  SED_INPLACE=(sed -i)
fi

# web/package.json
"${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" web/package.json

# MCP server
"${SED_INPLACE[@]}" "s/version: '[^']*'/version: '${VERSION}'/" web/server/mcpServer.ts

# Claude Code plugin
"${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" claudecode-plugin/.claude-plugin/plugin.json
"${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" claudecode-plugin/.claude-plugin/marketplace.json

# Codex plugin
"${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" codex-plugin/.codex-plugin/plugin.json

# OpenClaw plugin
"${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" openclaw-plugin/openclaw.plugin.json
"${SED_INPLACE[@]}" "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" openclaw-plugin/package.json

# Verify
echo ""
echo "Updated files:"
grep -n "\"version\"" web/package.json claudecode-plugin/.claude-plugin/plugin.json claudecode-plugin/.claude-plugin/marketplace.json codex-plugin/.codex-plugin/plugin.json openclaw-plugin/openclaw.plugin.json openclaw-plugin/package.json
grep -n "version:" web/server/mcpServer.ts | head -1
echo ""

# Commit, tag, push
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

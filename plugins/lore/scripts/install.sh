#!/usr/bin/env bash
set -euo pipefail

DEFAULT_BASE_URL="http://127.0.0.1:18901"
MARKETPLACE_NAME="lore"
PLUGIN_NAME="lore"
PLUGIN_ID="${PLUGIN_NAME}@${MARKETPLACE_NAME}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CODEX_CONFIG="${CODEX_CONFIG:-$CODEX_HOME/config.toml}"
TARGET_ROOT="${LORE_CODEX_MARKETPLACE_ROOT:-$CODEX_HOME/plugins/lore-local-marketplace}"
LORE_BASE_URL="${LORE_BASE_URL:-$DEFAULT_BASE_URL}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

copy_source_layout() {
  local source_marketplace_root=""
  local source_plugin_root="$PLUGIN_SOURCE_ROOT"

  if [ -d "$PLUGIN_SOURCE_ROOT/.agents" ] && [ -d "$PLUGIN_SOURCE_ROOT/.codex-plugin" ]; then
    source_marketplace_root="$PLUGIN_SOURCE_ROOT"
  elif [ -d "$PLUGIN_SOURCE_ROOT/.codex-plugin" ] && [ -d "$PLUGIN_SOURCE_ROOT/../../.agents" ]; then
    source_marketplace_root="$(cd "$PLUGIN_SOURCE_ROOT/../.." && pwd)"
  else
    echo "Cannot locate Codex plugin source layout from $PLUGIN_SOURCE_ROOT" >&2
    exit 1
  fi

  rm -rf "$TARGET_ROOT.tmp"
  mkdir -p "$TARGET_ROOT.tmp/plugins/$PLUGIN_NAME"

  cp -a "$source_marketplace_root/.agents" "$TARGET_ROOT.tmp/.agents"
  cp -a "$source_plugin_root/.codex-plugin" "$TARGET_ROOT.tmp/plugins/$PLUGIN_NAME/.codex-plugin"
  cp -a "$source_plugin_root/.mcp.json" "$TARGET_ROOT.tmp/plugins/$PLUGIN_NAME/.mcp.json"
  for entry in README.md skills hooks rules scripts assets; do
    if [ -e "$source_plugin_root/$entry" ]; then
      cp -a "$source_plugin_root/$entry" "$TARGET_ROOT.tmp/plugins/$PLUGIN_NAME/$entry"
    fi
  done

  rm -rf "$TARGET_ROOT"
  mv "$TARGET_ROOT.tmp" "$TARGET_ROOT"
}

enable_plugin_config() {
  mkdir -p "$(dirname "$CODEX_CONFIG")"
  touch "$CODEX_CONFIG"
  cp "$CODEX_CONFIG" "$CODEX_CONFIG.bak.$(date +%Y%m%d%H%M%S)"

  python3 - "$CODEX_CONFIG" "$PLUGIN_ID" <<'PY'
import sys

path, plugin_id = sys.argv[1], sys.argv[2]
section = f'[plugins."{plugin_id}"]'

with open(path, "r", encoding="utf-8") as handle:
    lines = handle.read().splitlines()

out = []
idx = 0
found = False
while idx < len(lines):
    line = lines[idx]
    if line.strip() == section:
        found = True
        out.append(line)
        idx += 1
        enabled_written = False
        while idx < len(lines) and not lines[idx].lstrip().startswith("["):
            if lines[idx].strip().startswith("enabled"):
                out.append("enabled = true")
                enabled_written = True
            else:
                out.append(lines[idx])
            idx += 1
        if not enabled_written:
            out.append("enabled = true")
        continue
    out.append(line)
    idx += 1

if not found:
    if out and out[-1] != "":
        out.append("")
    out.extend([section, "enabled = true"])

with open(path, "w", encoding="utf-8") as handle:
    handle.write("\n".join(out).rstrip() + "\n")
PY
}

register_marketplace() {
  codex plugin marketplace remove "$MARKETPLACE_NAME" >/dev/null 2>&1 || true
  codex plugin marketplace add "$TARGET_ROOT"
}

configure_mcp() {
  local url="${LORE_BASE_URL%/}/api/mcp?client_type=codex"
  local token_env="${LORE_BEARER_TOKEN_ENV_VAR:-}"
  if [ -z "$token_env" ]; then
    if [ -n "${LORE_API_TOKEN:-}" ]; then
      token_env="LORE_API_TOKEN"
    elif [ -n "${API_TOKEN:-}" ]; then
      token_env="API_TOKEN"
    fi
  fi

  codex mcp remove lore >/dev/null 2>&1 || true
  if [ -n "$token_env" ]; then
    codex mcp add lore --url "$url" --bearer-token-env-var "$token_env"
  else
    codex mcp add lore --url "$url"
  fi
}

install_hooks() {
  "$TARGET_ROOT/plugins/$PLUGIN_NAME/scripts/install-hooks.sh"
}

require_command codex
require_command jq
require_command python3

copy_source_layout
jq -e '.plugins[0].source.path == "./plugins/lore"' "$TARGET_ROOT/.agents/plugins/marketplace.json" >/dev/null
jq -e '.mcpServers.lore.url | contains("client_type=codex")' "$TARGET_ROOT/plugins/$PLUGIN_NAME/.mcp.json" >/dev/null

register_marketplace
enable_plugin_config
configure_mcp
install_hooks

echo ""
echo "Lore Codex plugin installed."
echo "Marketplace: $TARGET_ROOT"
echo "Plugin: $PLUGIN_ID enabled in $CODEX_CONFIG"
echo "MCP: ${LORE_BASE_URL%/}/api/mcp?client_type=codex"
echo "Hooks: $CODEX_HOME/hooks.json"
echo "Restart Codex for plugin and hook changes to take effect."

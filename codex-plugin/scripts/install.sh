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
INSTALLED_PLUGIN_ROOT="$CODEX_HOME/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/local"
LORE_CONFIG_FILE="${LORE_CONFIG_FILE:-$HOME/.lore/config.json}"

read_lore_config_value() {
  local key="$1"
  python3 - "$LORE_CONFIG_FILE" "$key" <<'PY' 2>/dev/null || true
import json
import sys

path, key = sys.argv[1], sys.argv[2]
try:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    value = data.get(key, "")
    print(value if isinstance(value, str) else "")
except Exception:
    pass
PY
}

SHARED_LORE_BASE_URL="$(read_lore_config_value base_url)"
SHARED_LORE_API_TOKEN="$(read_lore_config_value api_token)"

LORE_BASE_URL="${SHARED_LORE_BASE_URL:-${LORE_BASE_URL:-}}"
LORE_BASE_URL="${LORE_BASE_URL:-$DEFAULT_BASE_URL}"
LORE_API_TOKEN="${SHARED_LORE_API_TOKEN:-${LORE_API_TOKEN:-${API_TOKEN:-}}}"

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

enable_codex_hooks_feature() {
  mkdir -p "$(dirname "$CODEX_CONFIG")"
  touch "$CODEX_CONFIG"
  cp "$CODEX_CONFIG" "$CODEX_CONFIG.bak.$(date +%Y%m%d%H%M%S)"

  python3 - "$CODEX_CONFIG" <<'PY'
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as handle:
    lines = handle.read().splitlines()
out = []
idx = 0
found = False
while idx < len(lines):
    line = lines[idx]
    if line.strip() == "[features]":
        found = True
        out.append(line)
        idx += 1
        written = False
        while idx < len(lines) and not lines[idx].lstrip().startswith("["):
            stripped = lines[idx].strip()
            if stripped.startswith("hooks") or stripped.startswith("codex_hooks"):
                if not written:
                    out.append("hooks = true")
                    written = True
            else:
                out.append(lines[idx])
            idx += 1
        if not written:
            out.append("hooks = true")
        continue
    out.append(line)
    idx += 1
if not found:
    if out and out[-1] != "":
        out.append("")
    out.extend(["[features]", "hooks = true"])
with open(path, "w", encoding="utf-8") as handle:
    handle.write("\n".join(out).rstrip() + "\n")
PY
}

configure_mcp() {
  local url="${LORE_BASE_URL%/}/api/mcp?client_type=codex"
  local token="${LORE_API_TOKEN:-${API_TOKEN:-}}"

  codex mcp remove lore >/dev/null 2>&1 || true
  codex mcp add lore --url "$url"

  python3 - "$CODEX_CONFIG" "$url" "$token" <<'PY'
import json
import sys

path, url, token = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path, encoding="utf-8") as handle:
        lines = handle.read().splitlines()
except FileNotFoundError:
    lines = []

section = "[mcp_servers.lore]"
out = []
idx = 0
found = False
while idx < len(lines):
    line = lines[idx]
    if line.strip() == section:
        found = True
        out.append(line)
        idx += 1
        url_written = False
        while idx < len(lines) and not lines[idx].lstrip().startswith("["):
            stripped = lines[idx].strip()
            if stripped.startswith("url"):
                out.append(f"url = {json.dumps(url)}")
                url_written = True
            elif stripped.startswith("bearer_token_env_var") or stripped.startswith("http_headers") or stripped.startswith("env_http_headers"):
                pass
            else:
                out.append(lines[idx])
            idx += 1
        if not url_written:
            out.append(f"url = {json.dumps(url)}")
        if token:
            out.append(f"http_headers = {{ Authorization = {json.dumps('Bearer ' + token)} }}")
        continue
    out.append(line)
    idx += 1

if not found:
    if out and out[-1] != "":
        out.append("")
    out.append(section)
    out.append(f"url = {json.dumps(url)}")
    if token:
        out.append(f"http_headers = {{ Authorization = {json.dumps('Bearer ' + token)} }}")

with open(path, "w", encoding="utf-8") as handle:
    handle.write("\n".join(out).rstrip() + "\n")
PY
}

install_user_hooks() {
  # Compatibility path: Codex currently executes config-layer hooks, not plugin-local hooks.
  "$INSTALLED_PLUGIN_ROOT/scripts/install-hooks.sh"
}

require_command codex
require_command jq
require_command python3

copy_source_layout
rm -rf "$INSTALLED_PLUGIN_ROOT.tmp"
mkdir -p "$(dirname "$INSTALLED_PLUGIN_ROOT")"
cp -a "$TARGET_ROOT/plugins/$PLUGIN_NAME" "$INSTALLED_PLUGIN_ROOT.tmp"
rm -rf "$INSTALLED_PLUGIN_ROOT"
mv "$INSTALLED_PLUGIN_ROOT.tmp" "$INSTALLED_PLUGIN_ROOT"
python3 - "$INSTALLED_PLUGIN_ROOT/hooks/hooks.json" "$INSTALLED_PLUGIN_ROOT" <<'PY'
import sys
from pathlib import Path
hooks_path = Path(sys.argv[1])
plugin_root = sys.argv[2]
if hooks_path.exists():
    hooks_path.write_text(hooks_path.read_text().replace("__LORE_CODEX_PLUGIN_ROOT__", plugin_root))
PY
jq -e '.plugins[0].source.path == "./plugins/lore"' "$TARGET_ROOT/.agents/plugins/marketplace.json" >/dev/null
jq -e '.mcpServers.lore.url | contains("client_type=codex")' "$INSTALLED_PLUGIN_ROOT/.mcp.json" >/dev/null

register_marketplace
enable_plugin_config
enable_codex_hooks_feature
configure_mcp
install_user_hooks

echo ""
echo "Lore Codex plugin installed."
echo "Marketplace: $TARGET_ROOT"
echo "Plugin: $PLUGIN_ID enabled in $CODEX_CONFIG"
echo "MCP: ${LORE_BASE_URL%/}/api/mcp?client_type=codex"
echo "Installed plugin: $INSTALLED_PLUGIN_ROOT"
echo "Hooks: bundled in $INSTALLED_PLUGIN_ROOT/hooks/hooks.json"
echo "User hooks: $CODEX_HOME/hooks.json"
echo "Open /hooks and trust the Lore user hooks if Codex asks for review."
echo "Restart Codex for plugin and hook changes to take effect."

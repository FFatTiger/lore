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
LORE_SKILLS_EXPLICIT="${LORE_SKILLS_ENABLED+x}"
LORE_SKILLS_ENABLED="${LORE_SKILLS_ENABLED:-0}"
# Unset means auto-detect. Explicit 0 is a hard local kill switch.
if [ -z "$LORE_SKILLS_EXPLICIT" ]; then
  health_body=$(curl -fsSL --max-time 8 ${LORE_API_TOKEN:+-H "Authorization: Bearer ${LORE_API_TOKEN}"} "${LORE_BASE_URL%/}/api/health" 2>/dev/null || true)
  if printf '%s' "$health_body" | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("capabilities",{}).get("skills") is True else 1)' 2>/dev/null; then
    LORE_SKILLS_ENABLED=1
  fi
fi

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
  if [ -d "$source_plugin_root/local-skills-mcp" ]; then
    cp -a "$source_plugin_root/local-skills-mcp" "$TARGET_ROOT.tmp/plugins/$PLUGIN_NAME/local-skills-mcp"
  elif [ -d "$source_plugin_root/../local-skills-mcp" ]; then
    cp -a "$source_plugin_root/../local-skills-mcp" "$TARGET_ROOT.tmp/plugins/$PLUGIN_NAME/local-skills-mcp"
  else
    echo "Cannot locate local-skills-mcp beside $source_plugin_root" >&2
    exit 1
  fi

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

patch_hook_placeholders() {
  local plugin_root="$1"
  local hooks_json="$plugin_root/hooks/hooks.json"
  [ -f "$hooks_json" ] || return 0
  python3 - "$hooks_json" "$plugin_root" <<'PY'
import sys
from pathlib import Path
hooks_path = Path(sys.argv[1])
plugin_root = sys.argv[2]
hooks_path.write_text(hooks_path.read_text().replace("__LORE_CODEX_PLUGIN_ROOT__", plugin_root))
PY
}

remove_stale_installed_plugin_roots() {
  local cache_parent="$CODEX_HOME/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME"
  [ -d "$cache_parent" ] || return 0
  find "$cache_parent" -mindepth 1 -maxdepth 1 -type d ! -name local -exec rm -rf {} +
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
  local skills_server="${INSTALLED_PLUGIN_ROOT}/local-skills-mcp/src/server.mjs"
  local lore_home="${LORE_HOME:-$HOME/.lore}"

  codex mcp remove lore >/dev/null 2>&1 || true
  codex mcp remove lore-skills >/dev/null 2>&1 || true
  codex mcp add lore --url "$url"

  python3 - "$CODEX_CONFIG" "$url" "$token" "$skills_server" "$lore_home" "${LORE_BASE_URL%/}" "$LORE_SKILLS_ENABLED" <<'PY'
import json
import sys

path, url, token, skills_server, lore_home, base_url, skills_enabled = sys.argv[1:8]
try:
    with open(path, encoding="utf-8") as handle:
        lines = handle.read().splitlines()
except FileNotFoundError:
    lines = []

def upsert_section(lines, section, body_lines):
    out = []
    idx = 0
    found = False
    while idx < len(lines):
        line = lines[idx]
        if line.strip() == section:
            found = True
            out.append(line)
            idx += 1
            while idx < len(lines) and not lines[idx].lstrip().startswith("["):
                idx += 1
            out.extend(body_lines)
            continue
        out.append(line)
        idx += 1
    if not found:
        if out and out[-1] != "":
            out.append("")
        out.append(section)
        out.extend(body_lines)
    return out

def remove_section(lines, section):
    out = []
    idx = 0
    while idx < len(lines):
        if lines[idx].strip() == section:
            idx += 1
            while idx < len(lines) and not lines[idx].lstrip().startswith("["):
                idx += 1
            continue
        out.append(lines[idx])
        idx += 1
    return out

lore_body = [f"url = {json.dumps(url)}"]
if token:
    lore_body.append(f"http_headers = {{ Authorization = {json.dumps('Bearer ' + token)} }}")

skills_env_parts = [
    f"LORE_HOME = {json.dumps(lore_home)}",
    f"LORE_BASE_URL = {json.dumps(base_url)}",
    'LORE_CLIENT_TYPE = "codex"',
    'LORE_SKILLS_ENABLED = "1"',
]
if token:
    skills_env_parts.append(f"LORE_API_TOKEN = {json.dumps(token)}")
skills_body = [
    'command = "node"',
    f"args = {json.dumps([skills_server, '--client-type', 'codex'])}",
    f"env = {{ {', '.join(skills_env_parts)} }}",
]

lines = upsert_section(lines, "[mcp_servers.lore]", lore_body)
if skills_enabled == "1":
    lines = upsert_section(lines, "[mcp_servers.lore-skills]", skills_body)
else:
    lines = remove_section(lines, "[mcp_servers.lore-skills]")

with open(path, "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines).rstrip() + "\n")
PY
}

install_user_hooks() {
  # Legacy compatibility path for Codex builds that cannot execute plugin-bundled hooks.
  "$INSTALLED_PLUGIN_ROOT/scripts/install-hooks.sh"
}

remove_legacy_user_hooks() {
  local hooks_json="$CODEX_HOME/hooks.json"
  [ -f "$hooks_json" ] || return 0
  cp "$hooks_json" "$hooks_json.bak.$(date +%Y%m%d%H%M%S)"
  node - "$hooks_json" <<'NODE'
const fs = require('node:fs');
const hooksJson = process.argv[2];
let data = { hooks: {} };
try {
  const raw = fs.readFileSync(hooksJson, 'utf8').trim();
  if (raw) data = JSON.parse(raw);
} catch {
  process.exit(0);
}
if (!data || typeof data !== 'object' || Array.isArray(data) || !data.hooks || typeof data.hooks !== 'object') {
  process.exit(0);
}
const isLoreHookEntry = (entry) => {
  const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
  return hooks.some((hook) => {
    const command = String(hook?.command || '');
    return command.includes('/hooks/lore/hooks/rules-inject.')
      || command.includes('/hooks/lore/hooks/recall-inject.')
      || (command.includes('LORE_CODEX_PLUGIN_ROOT=') && command.includes('rules-inject.'))
      || (command.includes('LORE_CODEX_PLUGIN_ROOT=') && command.includes('recall-inject.'));
  });
};
for (const eventName of Object.keys(data.hooks)) {
  if (Array.isArray(data.hooks[eventName])) {
    data.hooks[eventName] = data.hooks[eventName].filter((entry) => !isLoreHookEntry(entry));
  }
}
fs.writeFileSync(hooksJson, JSON.stringify(data, null, 2) + '\n');
NODE
}

require_command codex
require_command jq
require_command python3

copy_source_layout
remove_stale_installed_plugin_roots
rm -rf "$INSTALLED_PLUGIN_ROOT.tmp"
mkdir -p "$(dirname "$INSTALLED_PLUGIN_ROOT")"
cp -a "$TARGET_ROOT/plugins/$PLUGIN_NAME" "$INSTALLED_PLUGIN_ROOT.tmp"
rm -rf "$INSTALLED_PLUGIN_ROOT"
mv "$INSTALLED_PLUGIN_ROOT.tmp" "$INSTALLED_PLUGIN_ROOT"
patch_hook_placeholders "$INSTALLED_PLUGIN_ROOT"
patch_hook_placeholders "$TARGET_ROOT/plugins/$PLUGIN_NAME"
jq -e '.plugins[0].source.path == "./plugins/lore"' "$TARGET_ROOT/.agents/plugins/marketplace.json" >/dev/null
jq -e '.mcpServers.lore.url | contains("client_type=codex")' "$INSTALLED_PLUGIN_ROOT/.mcp.json" >/dev/null
jq -e '(.mcpServers["lore-skills"] // null) == null' "$INSTALLED_PLUGIN_ROOT/.mcp.json" >/dev/null
[ -f "$INSTALLED_PLUGIN_ROOT/local-skills-mcp/src/server.mjs" ]

register_marketplace
enable_plugin_config
enable_codex_hooks_feature
configure_mcp
remove_legacy_user_hooks
if [ "${LORE_CODEX_INSTALL_USER_HOOKS:-}" = "1" ]; then
  install_user_hooks
fi

echo ""
echo "Lore Codex plugin installed."
echo "Marketplace: $TARGET_ROOT"
echo "Plugin: $PLUGIN_ID enabled in $CODEX_CONFIG"
echo "MCP: ${LORE_BASE_URL%/}/api/mcp?client_type=codex"
echo "Installed plugin: $INSTALLED_PLUGIN_ROOT"
echo "Hooks: bundled in $INSTALLED_PLUGIN_ROOT/hooks/hooks.json"
echo "Legacy user hooks: removed from $CODEX_HOME/hooks.json unless LORE_CODEX_INSTALL_USER_HOOKS=1"
echo "Open /hooks and trust the Lore plugin hooks if Codex asks for review."
echo "Restart Codex for plugin and hook changes to take effect."

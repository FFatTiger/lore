#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Lore uninstall script — remove Lore from all agent runtimes
# =============================================================================
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/uninstall.sh | bash -s -- [OPTIONS]
#
# Options:
#   --channels CH,...    Channels: claudecode,codex,pi,openclaw,hermes; default all
#   --purge              Also remove config and Docker data
#   -y                   Skip confirmation prompt
#   -h, --help           Show help
#
# Examples:
#   # Uninstall all channels
#   curl -fsSL .../uninstall.sh | bash -s --
#
#   # Uninstall specific channels
#   curl -fsSL .../uninstall.sh | bash -s -- --channels claudecode,codex
#
#   # Full purge (config + docker data)
#   curl -fsSL .../uninstall.sh | bash -s -- --purge -y

# ---- Args ----

CHANNELS_RAW=""
PURGE=0
SKIP_CONFIRM=0
SHOW_HELP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channels) CHANNELS_RAW="$2"; shift 2;;
    --purge)    PURGE=1; shift;;
    -y)         SKIP_CONFIRM=1; shift;;
    -h|--help)  SHOW_HELP=1; shift;;
    *) shift;;
  esac
done

# ---- Constants ----

ALL_CHANNELS=(claudecode codex pi openclaw hermes)
LORE_HOME="${LORE_HOME:-$HOME/.lore}"
LORE_CONFIG_FILE="$LORE_HOME/config.json"

# ---- Colors ----

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${BLUE}→${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1"; }
section() { echo ""; echo -e "${BOLD}── $1${NC}"; }

have_command() { command -v "$1" >/dev/null 2>&1; }

# ---- Resolve channels ----

resolve_channels() {
  if [[ -n "$CHANNELS_RAW" ]]; then
    IFS=',' read -ra CHANNELS <<< "$CHANNELS_RAW"
  else
    CHANNELS=("${ALL_CHANNELS[@]}")
  fi
}

confirm() {
  echo ""
  echo -e "  Channels: ${RED}${CHANNELS[*]}${NC}"
  [[ $PURGE -eq 1 ]] && echo -e "  ${YELLOW}--purge: will remove config + Docker data${NC}"
  echo ""

  if [[ $SKIP_CONFIRM -eq 1 ]] || ! [ -t 0 ]; then
    info "Proceeding automatically."
    return
  fi

  read -r -p "  Uninstall these channels? [y/N]: " answer
  [[ "$answer" =~ ^[Yy] ]] || { err "Aborted."; exit 1; }
}

# ---- Uninstall: Claude Code ----

uninstall_claudecode() {
  section "Claude Code"

  if have_command claude; then
    info "Removing lore plugin..."
    claude plugins uninstall lore@lore 2>/dev/null && \
      ok "Plugin lore@lore removed." || \
      info "Plugin lore@lore not found."
  else
    info "claude CLI not found, skipping plugin removal."
  fi

  # Remove env vars from settings.json
  local settings_file="$HOME/.claude/settings.json"
  if [[ -f "$settings_file" ]] && have_command python3; then
    info "Removing Lore env vars from settings.json..."
    python3 - "$settings_file" <<'PY'
import sys, json
path = sys.argv[1]
try:
    with open(path, 'r') as f: data = json.load(f)
except (json.JSONDecodeError, IOError): sys.exit(0)
changed = False
if isinstance(data, dict) and "env" in data:
    for key in ["LORE_BASE_URL", "LORE_API_TOKEN"]:
        if key in data["env"]:
            del data["env"][key]
            changed = True
    if not data["env"]:
        del data["env"]
if changed:
    with open(path, 'w') as f: json.dump(data, f, indent=2, ensure_ascii=False)
PY
    ok "Env vars removed from settings.json."
  fi

  # Remove lore-guidance.md
  local guidance="$HOME/.claude/lore-guidance.md"
  [[ -f "$guidance" ]] && { rm -f "$guidance"; ok "Removed $guidance"; }

  # Remove @import line from CLAUDE.md
  local claude_md="$HOME/.claude/CLAUDE.md"
  if [[ -f "$claude_md" ]] && grep -Eq '^(@~/.claude/lore-guidance\.md|@import ~/.claude/lore-guidance\.md)$' "$claude_md" 2>/dev/null; then
    info "Removing lore-guidance import from CLAUDE.md..."
    local tmp="${claude_md}.tmp.$$"
    grep -Ev '^(@~/.claude/lore-guidance\.md|@import ~/.claude/lore-guidance\.md)$' "$claude_md" > "$tmp"
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' '/./,$!d' "$tmp"
    else
      sed -i '/./,$!d' "$tmp"
    fi
    mv "$tmp" "$claude_md"
    ok "Import line removed from CLAUDE.md."
  fi

  # Remove plugin cache dir
  local plugin_cache="$HOME/.claude/plugins/cache/lore"
  [[ -d "$plugin_cache" ]] && { rm -rf "$plugin_cache"; ok "Removed $plugin_cache"; }

  ok "Claude Code uninstall complete."
}

# ---- Uninstall: Codex ----

uninstall_codex() {
  section "Codex"

  local codex_home="${CODEX_HOME:-$HOME/.codex}"

  if have_command codex; then
    info "Removing Lore marketplace..."
    codex plugin marketplace remove lore 2>/dev/null && \
      ok "Marketplace removed." || info "Marketplace not found."

    info "Removing Lore MCP server..."
    codex mcp remove lore 2>/dev/null && \
      ok "MCP server removed." || info "MCP server not found."
  else
    info "codex CLI not found, skipping CLI-based removal."
  fi

  # Remove plugin directories
  local plugin_dir="$codex_home/plugins/lore-local-marketplace"
  [[ -d "$plugin_dir" ]] && { rm -rf "$plugin_dir"; ok "Removed $plugin_dir"; }

  local plugin_cache="$codex_home/plugins/cache/lore"
  [[ -d "$plugin_cache" ]] && { rm -rf "$plugin_cache"; ok "Removed $plugin_cache"; }

  # Remove hooks directory
  local hook_dir="$codex_home/hooks/lore"
  [[ -d "$hook_dir" ]] && { rm -rf "$hook_dir"; ok "Removed $hook_dir"; }

  # Remove hook entries from hooks.json
  local hooks_json="$codex_home/hooks.json"
  if [[ -f "$hooks_json" ]] && have_command python3; then
    info "Removing Lore hooks from hooks.json..."
    python3 - "$hooks_json" <<'PY'
import sys, json
path = sys.argv[1]
try:
    with open(path, 'r') as f: data = json.load(f)
except (json.JSONDecodeError, IOError): sys.exit(0)
changed = False
if isinstance(data, dict) and "hooks" in data:
    for event_name in list(data["hooks"].keys()):
        entries = data["hooks"][event_name]
        if not isinstance(entries, list): continue
        filtered = [
            e for e in entries
            if not any(
                "/hooks/lore/hooks/recall-inject" in str(h.get("command", ""))
                for h in (e.get("hooks", []) if isinstance(e.get("hooks"), list) else [])
            )
        ]
        if len(filtered) < len(entries):
            changed = True
            if filtered:
                data["hooks"][event_name] = filtered
            else:
                del data["hooks"][event_name]
    if not data["hooks"]:
        del data["hooks"]
if changed:
    with open(path, 'w') as f: json.dump(data, f, indent=2, ensure_ascii=False)
PY
    ok "Hook entries removed from hooks.json."
  fi

  # Remove plugin config from config.toml
  local config_toml="$codex_home/config.toml"
  if [[ -f "$config_toml" ]] && have_command python3; then
    info "Removing Lore plugin config from config.toml..."
    python3 - "$config_toml" <<'PY'
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f: lines = f.read().splitlines()
section = '[plugins."lore@lore"]'
out = []
skip = False
for line in lines:
    if line.strip() == section:
        skip = True
        continue
    if skip:
        if line.lstrip().startswith("[") or (line.strip() == "" and out and out[-1].strip() != ""):
            skip = False
        else:
            continue
    out.append(line)
while out and out[-1].strip() == "": out.pop()
with open(path, "w", encoding="utf-8") as f: f.write("\n".join(out) + "\n")
PY
    ok "Plugin config removed from config.toml."
  fi

  ok "Codex uninstall complete."
}

# ---- Uninstall: Pi ----

uninstall_pi() {
  section "Pi"

  local pi_ext="$HOME/.pi/agent/extensions/lore"
  if [[ -L "$pi_ext" ]]; then
    rm -f "$pi_ext"
    ok "Removed Pi extension symlink."
  elif [[ -d "$pi_ext" ]]; then
    warn "$pi_ext is not a symlink — skipping."
  else
    info "Pi extension not found."
  fi

  local pi_dir="$LORE_HOME/pi"
  [[ -d "$pi_dir" ]] && { rm -rf "$pi_dir"; ok "Removed $pi_dir"; }

  ok "Pi uninstall complete."
}

# ---- Uninstall: OpenClaw ----

uninstall_openclaw() {
  section "OpenClaw"

  if have_command openclaw; then
    info "Disabling Lore plugin..."
    openclaw plugins disable lore 2>/dev/null || true
    info "Uninstalling Lore plugin..."
    openclaw plugins uninstall lore 2>/dev/null && \
      ok "Plugin uninstalled." || info "Plugin not found."
  else
    info "openclaw CLI not found, skipping CLI-based removal."
  fi

  local oc_config="$HOME/.openclaw/openclaw.json"
  if [[ -f "$oc_config" ]] && have_command python3; then
    info "Removing Lore config from openclaw.json..."
    python3 - "$oc_config" <<'PY'
import sys, json
path = sys.argv[1]
with open(path, 'r') as f: data = json.load(f)
changed = False
if isinstance(data, dict):
    entries = data.get("plugins", {}).get("entries", {})
    if "lore" in entries:
        del entries["lore"]
        changed = True
if changed:
    with open(path, 'w') as f: json.dump(data, f, indent=2, ensure_ascii=False)
PY
    ok "Config removed from openclaw.json."
  fi

  local oc_dir="$LORE_HOME/openclaw"
  [[ -d "$oc_dir" ]] && { rm -rf "$oc_dir"; ok "Removed $oc_dir"; }

  ok "OpenClaw uninstall complete."
}

# ---- Uninstall: Hermes ----

uninstall_hermes() {
  section "Hermes"

  info "Hermes install was manual (env vars + symlink)."
  info "Remove the lore_memory symlink and LORE_* env vars manually."

  local hermes_dir="$LORE_HOME/hermes"
  [[ -d "$hermes_dir" ]] && { rm -rf "$hermes_dir"; ok "Removed $hermes_dir"; }

  ok "Hermes uninstall complete."
}

# ---- Cleanup shared resources ----

cleanup_shared() {
  [[ $PURGE -eq 1 ]] || return

  section "Purge shared resources"

  [[ -f "$LORE_CONFIG_FILE" ]] && { rm -f "$LORE_CONFIG_FILE"; ok "Removed $LORE_CONFIG_FILE"; }

  local docker_dir="$LORE_HOME/docker"
  [[ -d "$docker_dir" ]] && { rm -rf "$docker_dir"; ok "Removed $docker_dir"; }

  # Remove LORE_HOME if empty
  if [[ -d "$LORE_HOME" ]] && [[ -z "$(ls -A "$LORE_HOME" 2>/dev/null)" ]]; then
    rmdir "$LORE_HOME"
    ok "Removed empty $LORE_HOME"
  fi
}

# ---- Summary ----

summary() {
  echo ""
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  Lore uninstall complete!${NC}"
  echo ""
  echo "  Uninstalled channels:"
  for ch in "${CHANNELS[@]}"; do
    echo -e "    ${GREEN}✓${NC} ${ch}"
  done
  echo ""
  echo "  Restart your agent runtime(s) for changes to take effect."
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════${NC}"
  echo ""
}

# ---- Main ----

main() {
  if [[ $SHOW_HELP -eq 1 ]]; then
    echo "Usage: curl -fsSL .../uninstall.sh | bash -s -- [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --channels CH,...  Channels to uninstall (default: all)"
    echo "  --purge            Also remove config and Docker data"
    echo "  -y                 Skip confirmation prompt"
    echo "  -h, --help         Show this help"
    exit 0
  fi

  echo ""
  echo -e "${RED}${BOLD} _     ____  ____  _____ ${NC}"
  echo -e "${RED}${BOLD}/ \   /  _ \/  __\/  __/ ${NC}  Lore — uninstall"
  echo -e "${RED}${BOLD}| |   | / \||  \/||  \   ${NC}"
  echo -e "${RED}${BOLD}| |_/\| \_/||    /|  /_  ${NC}  Remove Lore from agent runtimes."
  echo -e "${RED}${BOLD}\____/\____/\_/\_\\____\ ${NC}"
  echo ""

  resolve_channels
  confirm

  for ch in "${CHANNELS[@]}"; do
    case "$ch" in
      claudecode) uninstall_claudecode;;
      codex)      uninstall_codex;;
      pi)         uninstall_pi;;
      openclaw)   uninstall_openclaw;;
      hermes)     uninstall_hermes;;
    esac
  done

  cleanup_shared
  summary
}

main "$@"

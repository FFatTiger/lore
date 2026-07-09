#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Lore install script — one command to connect any agent runtime
# =============================================================================
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.sh | bash -s -- [OPTIONS]
#   curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.zh.sh | bash -s -- [OPTIONS]
#
# Options:
#   --base-url URL       Lore server base URL
#   --api-token TOKEN    Lore API token
#   --channels CH,...    Comma-separated: claudecode,codex,pi,openclaw,hermes
#                        Default: all 5
#   --skip-docker        Don't run docker compose up
#   --force              Force reinstall even if version unchanged
#   --pre                Use pre-release channel (pre-latest tag)
#   --dev                Use dev channel (dev-latest tag)
#
# Notes:
#   - Docker Compose output is shown so you can see image pull/start progress.
#   - Other installer subcommands are quiet; rerun with the same options if needed.
#   - Codex: restart Codex after install. Open /hooks and trust Lore hooks if prompted.
#     If /plugins still shows Lore as installable, install it there manually; MCP/hooks are
#     already configured by this script.

# ---- Args ----

BASE_URL=""
API_TOKEN=""
CHANNELS_RAW=""
SKIP_DOCKER=0
FORCE=0
CHECK_PRE=0
CHECK_DEV=0
SHOW_HELP=0
DOCKER_MANAGED=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)   BASE_URL="$2"; _EXPLICIT_BASE_URL=1; shift 2;;
    --api-token)  API_TOKEN="$2"; _EXPLICIT_API_TOKEN=1; shift 2;;
    --channels)   CHANNELS_RAW="$2"; shift 2;;
    --skip-docker) SKIP_DOCKER=1; shift;;
    --force)       FORCE=1; shift;;
    --pre)         CHECK_PRE=1; shift;;
    --dev)         CHECK_DEV=1; shift;;
    -h|--help)     SHOW_HELP=1; shift;;
    *) shift;;
  esac
done

# ---- Constants ----

REPO="FFatTiger/lore"
DEFAULT_BASE_URL="http://127.0.0.1:18901"
LORE_HOME="${LORE_HOME:-$HOME/.lore}"
LORE_CONFIG_FILE="$LORE_HOME/config.json"
LORE_DOCKER_DIR="$LORE_HOME/docker"
REPO_RAW="https://raw.githubusercontent.com/${REPO}/main"
LORE_INSTALL_LANG="${LORE_INSTALL_LANG:-en}"

# ---- Colors ----

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

banner() {
  echo ""
  if [[ "$LORE_INSTALL_LANG" == "zh" ]]; then
    echo -e "${BLUE}${BOLD} _     ____  ____  _____ ${NC}"
    echo -e "${BLUE}${BOLD}/ \   /  _ \/  __\/  __/ ${NC}  Lore — AI Agent 长期记忆"
    echo -e "${BLUE}${BOLD}| |   | / \||  \/||  \   ${NC}"
    echo -e "${BLUE}${BOLD}| |_/\| \_/||    /|  /_  ${NC}  一条安装脚本，接入所有 Agent 运行时"
    echo -e "${BLUE}${BOLD}\____/\____/\_/\_\\____\ ${NC}"
    echo -e "${BLUE}${BOLD}                        ${NC}"
  else
    echo -e "${BLUE}${BOLD} _     ____  ____  _____ ${NC}"
    echo -e "${BLUE}${BOLD}/ \   /  _ \/  __\/  __/ ${NC}  Lore — long-term memory for AI agents"
    echo -e "${BLUE}${BOLD}| |   | / \||  \/||  \   ${NC}"
    echo -e "${BLUE}${BOLD}| |_/\| \_/||    /|  /_  ${NC}  One install script, all agent runtimes."
    echo -e "${BLUE}${BOLD}\____/\____/\_/\_\\____\ ${NC}"
    echo -e "${BLUE}${BOLD}                        ${NC}"
  fi
  echo ""
}

info()  { echo -e "${BLUE}→${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1"; }
section() { echo ""; echo -e "${BOLD}── $1${NC}"; }
run_quiet() { "$@" >/dev/null 2>&1; }

print_usage() {
  if [[ "$LORE_INSTALL_LANG" == "zh" ]]; then
    cat <<'EOF'
用法：
  curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.zh.sh | bash -s -- [选项]

选项：
  --base-url URL       使用已有 Lore 服务地址；传入后不会启动 Docker
  --api-token TOKEN    Lore API Token
  --channels CH,...    安装渠道：claudecode,codex,pi,openclaw,hermes；默认全部
  --skip-docker        不运行 docker compose
  --force              即使版本相同也重新安装
  --pre                使用 pre-latest 镜像/预发布包
  --dev                使用 dev-latest 镜像/开发包

说明：
  - Docker Compose 的 pull/up 输出会保留，便于观察启动进度。
  - 其他命令默认静默，只输出安装脚本自己的关键状态。
  - Codex 安装后请重启 Codex，打开 /hooks 并按提示 trust Lore hooks。
  - 如果 Codex 的 /plugins 仍提示 Lore 可安装，手动安装即可；MCP/hooks 已由脚本配置。
EOF
  else
    cat <<'EOF'
Usage:
  curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.sh | bash -s -- [OPTIONS]

Options:
  --base-url URL       Use an existing Lore server; skips Docker
  --api-token TOKEN    Lore API token
  --channels CH,...    Channels: claudecode,codex,pi,openclaw,hermes; default all
  --skip-docker        Do not run docker compose
  --force              Reinstall even if version is unchanged
  --pre                Use pre-latest image/pre-release artifacts
  --dev                Use dev-latest image/dev artifacts

Notes:
  - Docker Compose pull/up output is shown so you can see startup progress.
  - Other subcommands are quiet; only key installer status is printed.
  - Codex: restart Codex, open /hooks, and trust Lore hooks if prompted.
  - If Codex /plugins still shows Lore as installable, install it manually; MCP/hooks are already configured.
EOF
  fi
}

msg_restart() {
  if [[ "$LORE_INSTALL_LANG" == "zh" ]]; then
    info "下一步：重启 Agent，然后打开 ${BASE_URL}/setup"
    info "Codex：打开 /hooks，按提示信任 Lore hooks"
    info "Codex：如果 /plugins 仍显示 Lore 可安装，手动安装即可"
  else
    info "Next: restart agent runtimes, then open ${BASE_URL}/setup"
    info "Codex: open /hooks and trust Lore hooks if prompted"
    info "Codex: if /plugins still shows Lore as installable, install it manually"
  fi
}

have_command() { command -v "$1" >/dev/null 2>&1; }

# ---- Config file ----

read_config_value() {
  local key="$1"
  if [[ -f "$LORE_CONFIG_FILE" ]]; then
    python3 - "$LORE_CONFIG_FILE" "$key" <<'PY' 2>/dev/null
import json
import sys

path, key = sys.argv[1], sys.argv[2]
try:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    value = data.get(key, "") if isinstance(data, dict) else ""
    print(value if isinstance(value, str) else "")
except Exception:
    pass
PY
  fi
}

read_config() {
  read_config_value "base_url"
}

read_config_token() {
  read_config_value "api_token"
}

read_config_docker_managed() {
  if [[ -f "$LORE_CONFIG_FILE" ]]; then
    python3 - "$LORE_CONFIG_FILE" <<'PY' 2>/dev/null
import json
import sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    print(data.get("docker_managed", False) if isinstance(data, dict) else False)
except Exception:
    pass
PY
  fi
}

write_config() {
  local write_version="${1:-1}"
  mkdir -p "$LORE_HOME"
  local new_ver=""
  # Only bump installed_version if we actually installed
  if [[ "$write_version" == "1" && $NEED_INSTALL -ne 2 ]]; then
    new_ver="${RELEASE_VERSION:-}"
  fi

  python3 - "$LORE_CONFIG_FILE" "$BASE_URL" "$API_TOKEN" "$new_ver" "$DOCKER_MANAGED" <<'PY'
import sys, json, os
path = sys.argv[1]
base_url = sys.argv[2]
api_token = sys.argv[3]
version = sys.argv[4]
docker_managed = sys.argv[5]

data = {}
if os.path.exists(path):
    try:
        with open(path, 'r') as f: data = json.load(f)
    except: data = {}

data['base_url'] = base_url
if api_token:
    data['api_token'] = api_token
if version: data['installed_version'] = version
if docker_managed == "1":
    data['docker_managed'] = True
elif docker_managed == "0":
    data['docker_managed'] = False
elif 'docker_managed' not in data:
    data['docker_managed'] = False

with open(path, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
PY
  if [[ "$write_version" == "1" ]]; then
    ok "Config saved"
  else
    ok "Client config saved"
  fi
}

# ---- Resolve channels ----

ALL_CHANNELS=(claudecode codex pi openclaw hermes)

resolve_channels() {
  if [[ -n "$CHANNELS_RAW" ]]; then
    IFS=',' read -ra CHANNELS <<< "$CHANNELS_RAW"
  else
    CHANNELS=("${ALL_CHANNELS[@]}")
  fi
}

# ---- Docker ----

update_docker() {
  if ! have_command docker; then
    warn "Docker not found. Cannot update."
    return
  fi

  local compose_cmd
  if docker compose version >/dev/null 2>&1; then
    compose_cmd="docker compose"
  elif have_command docker-compose; then
    compose_cmd="docker-compose"
  else
    warn "docker compose not found. Cannot update."
    return
  fi

  section "Docker"; info "Updating containers"

  # Download latest docker-compose.yml
  local compose_url="${REPO_RAW}/docker-compose.yml"
  if [[ -f "$LORE_DOCKER_DIR/docker-compose.yml" ]]; then
    cp "$LORE_DOCKER_DIR/docker-compose.yml" "$LORE_DOCKER_DIR/docker-compose.yml.bak.$(date +%Y%m%d%H%M%S)"
  fi
  curl -fsSL "$compose_url" -o "$LORE_DOCKER_DIR/docker-compose.yml" || {
    warn "Failed to download docker-compose.yml"
    return
  }

  # Update .env tag if --dev/--pre changed
  if [[ -f "$LORE_DOCKER_DIR/.env" ]]; then
    local tag="latest"
    [[ "$CHECK_DEV" == "1" ]] && tag="dev-latest"
    [[ "$CHECK_PRE" == "1" ]] && tag="pre-latest"
    python3 - "$LORE_DOCKER_DIR/.env" "$tag" "$LORE_DOCKER_DIR" <<'PY'
import sys
path, tag, docker_dir = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f: lines = f.readlines()
out = []; found = False
for line in lines:
    if line.startswith('LORE_FRONTEND_IMAGE='):
        out.append(f'LORE_FRONTEND_IMAGE=fffattiger/lore:{tag}\n'); found = True
    else: out.append(line)
if not found: out.append(f'LORE_FRONTEND_IMAGE=fffattiger/lore:{tag}\n')
keys = {line.split('=', 1)[0] for line in out if '=' in line and not line.lstrip().startswith('#')}
if 'REDIS_DATA_DIR' not in keys: out.append(f'REDIS_DATA_DIR={docker_dir}/data/redis\n')
if 'REDIS_URL' not in keys: out.append('REDIS_URL=redis://redis:6379/0\n')
with open(path, 'w') as f: f.writelines(out)
PY
  fi

  (
    cd "$LORE_DOCKER_DIR"
    $compose_cmd pull || { warn "docker compose pull failed."; return; }
    $compose_cmd up -d || { warn "docker compose up -d failed."; return; }
  )

  ok "Docker updated"
}

start_docker() {
  if [[ "$SKIP_DOCKER" == "1" ]]; then
    if [[ -z "${_EXPLICIT_BASE_URL:-}" ]]; then
      local saved; saved=$(read_config)
      if [[ -n "$saved" ]]; then
        BASE_URL="$saved"
      fi
    fi
    info "Skipping Docker"
    return
  fi

  # Only skip docker if user explicitly passed --base-url
  if [[ -n "${_EXPLICIT_BASE_URL:-}" ]]; then
    info "Using external Lore server"
    DOCKER_MANAGED=0
    return
  fi

  # If config.json already has a saved base_url, this is an update
  local saved; saved=$(read_config)
  if [[ -n "$saved" ]]; then
    BASE_URL="$saved"
    local managed; managed=$(read_config_docker_managed)
    if [[ "$managed" == "True" ]]; then
      update_docker
    else
      info "Using saved external server"
    fi
    return
  fi

  if ! have_command docker; then
    warn "Docker not found. Install Docker first, or use --base-url for external server."
    return
  fi

  # Detect docker compose variant (plugin vs standalone)
  local compose_cmd
  if docker compose version >/dev/null 2>&1; then
    compose_cmd="docker compose"
  elif have_command docker-compose; then
    compose_cmd="docker-compose"
  else
    warn "docker compose not found. Install Docker Compose first."
    return
  fi

  section "Docker"; info "Starting containers"
  mkdir -p "$LORE_DOCKER_DIR"

  # Download docker-compose.yml from repo
  local compose_url="${REPO_RAW}/docker-compose.yml"
  curl -fsSL "$compose_url" -o "$LORE_DOCKER_DIR/docker-compose.yml" || {
    warn "Failed to download docker-compose.yml"
    return
  }

  # Write .env if not exists
  if [[ ! -f "$LORE_DOCKER_DIR/.env" ]]; then
    local pg_pass
    pg_pass=$(python3 -c "import secrets; print(secrets.token_hex(16))" 2>/dev/null || echo "lore-$(date +%s)")
    cat > "$LORE_DOCKER_DIR/.env" <<EOF
TZ=Asia/Shanghai
POSTGRES_DB=lore
POSTGRES_USER=lore
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_PORT=55439
WEB_PORT=18901
POSTGRES_DATA_DIR=${LORE_DOCKER_DIR}/data/postgres
SNAPSHOT_DATA_DIR=${LORE_DOCKER_DIR}/data/snapshots
REDIS_DATA_DIR=${LORE_DOCKER_DIR}/data/redis
REDIS_URL=redis://redis:6379/0
DATABASE_URL=postgresql://lore:${pg_pass}@postgres:5432/lore
EOF
    if [[ "$CHECK_DEV" == "1" ]]; then
      echo "LORE_FRONTEND_IMAGE=fffattiger/lore:dev-latest" >> "$LORE_DOCKER_DIR/.env"
    elif [[ "$CHECK_PRE" == "1" ]]; then
      echo "LORE_FRONTEND_IMAGE=fffattiger/lore:pre-latest" >> "$LORE_DOCKER_DIR/.env"
    fi
    ok "Docker env written"
  fi

  (
    cd "$LORE_DOCKER_DIR"
    $compose_cmd up -d || {
      warn "$compose_cmd up failed. Check $LORE_DOCKER_DIR/docker-compose.yml"
      exit 1
    }
  ) || return

  DOCKER_MANAGED=1
  ok "Lore server starting"
  BASE_URL="$DEFAULT_BASE_URL"

  # Wait for health
  info "Waiting for health check"
  local attempts=0
  while [[ $attempts -lt 60 ]]; do
    if curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; then
      ok "Lore server healthy"
      return
    fi
    sleep 3
    attempts=$((attempts + 1))
    # Show progress every 30 seconds
    if [[ $((attempts % 10)) -eq 0 ]]; then
      info "Still waiting (${attempts}0s)"
    fi
  done
  warn "Lore health check timed out (3 min). Check: $compose_cmd -f $LORE_DOCKER_DIR/docker-compose.yml logs"
}

# ---- Release / version ----

RELEASE_VERSION=""
NEED_INSTALL=0

check_release() {
  info "Checking release"

  if [[ "$CHECK_DEV" == "1" ]]; then
    info "Using dev channel"
    RELEASE_VERSION="dev"
    NEED_INSTALL=0
    return
  fi

  local api_url
  if [[ "$CHECK_PRE" == "1" ]]; then
    api_url="https://api.github.com/repos/${REPO}/releases?per_page=1"
  else
    api_url="https://api.github.com/repos/${REPO}/releases/latest"
  fi

  local release_json
  release_json=$(curl -fsSL "$api_url" 2>/dev/null) || {
    warn "Cannot reach GitHub API."
    NEED_INSTALL=1
    return
  }

  if [[ "$CHECK_PRE" == "1" ]]; then
    RELEASE_VERSION=$(echo "$release_json" | python3 -c "
import sys, json
arr = json.loads(sys.stdin.read())
print(arr[0].get('tag_name','') if arr else '')
" 2>/dev/null)
  else
    RELEASE_VERSION=$(echo "$release_json" | python3 -c "
import sys, json
print(json.loads(sys.stdin.read()).get('tag_name',''))
" 2>/dev/null)
  fi

  if [[ -z "$RELEASE_VERSION" ]]; then
    warn "Could not determine latest release version."
    NEED_INSTALL=1
    return
  fi

  local installed
  installed=$(python3 - "$LORE_CONFIG_FILE" <<'PY' 2>/dev/null
import json
import sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    print(data.get("installed_version", "") if isinstance(data, dict) else "")
except Exception:
    pass
PY
) || installed=""

  # Semver compare: don't downgrade
  if [[ -n "$installed" && "$FORCE" != "1" ]]; then
    local cmp; cmp=$(python3 -c "
import re

def parse(v):
    v = v.lstrip('v')
    m = re.match(r'(\d+)\.(\d+)\.(\d+)(?:-(.*))?', v)
    if not m: return (0,0,0, '', '')
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)),
            m.group(4) or '', 'pre' in (m.group(4) or ''))

a = parse('$installed')
b = parse('$RELEASE_VERSION')

# pre-release < stable at same version
if a[:3] == b[:3]:
    if a[4] and not b[4]: print('older')  # installed pre, release stable → upgrade
    elif not a[4] and b[4]: print('downgrade')  # installed stable, release pre → skip
    elif a == b: print('same')
    else: print('newer' if a > b else 'older')
else:
    print('newer' if a > b else 'older')
" 2>/dev/null) || cmp="unknown"

    if [[ "$cmp" == "same" ]]; then
      ok "Already up to date: $RELEASE_VERSION"
      NEED_INSTALL=2
    elif [[ "$cmp" == "newer" ]]; then
      ok "Installed $installed (newer than $RELEASE_VERSION). Use --pre to check pre-releases."
      NEED_INSTALL=2
    elif [[ "$cmp" == "downgrade" ]]; then
      warn "Release $RELEASE_VERSION is older than installed $installed. Use --force to downgrade."
      NEED_INSTALL=2
    else
      info "Update available: $installed → $RELEASE_VERSION"
      NEED_INSTALL=0
    fi
  elif [[ -n "$installed" ]]; then
    info "Update available: $installed → $RELEASE_VERSION"
    NEED_INSTALL=0
  else
    info "Installing version: $RELEASE_VERSION"
    NEED_INSTALL=0
  fi
}

# ---- Artifact download ----

artifact_for() {
  case "$1" in
    claudecode) echo "lore-claudecode.zip";;
    codex)      echo "lore-codex.zip";;
    pi)         echo "lore-pi.zip";;
    openclaw)   echo "lore-openclaw.zip";;
    hermes)     echo "lore-hermes.zip";;
  esac
}

download_artifact() {
  local channel="$1" dest="$2"
  local artifact; artifact=$(artifact_for "$channel")
  if [[ -z "$artifact" ]]; then
    warn "No artifact for: $channel"
    return 1
  fi

  local url="https://github.com/${REPO}/releases/download/${RELEASE_VERSION}/${artifact}"

  info "Downloading $channel"
  rm -rf "$dest.tmp"
  mkdir -p "$dest.tmp"

  curl -fsSL "$url" -o "$dest.tmp/${artifact}" 2>/dev/null || {
    warn "Download failed: $url"
    rm -rf "$dest.tmp"
    return 1
  }

  unzip -qo "$dest.tmp/${artifact}" -d "$dest.tmp/extracted" 2>/dev/null || {
    warn "Extract failed for ${artifact}"
    rm -rf "$dest.tmp"
    return 1
  }

  rm -rf "$dest"
  mv "$dest.tmp/extracted" "$dest"
  rm -rf "$dest.tmp"
  ok "$channel files ready"
  return 0
}

download_or_skip() {
  local channel="$1" dest="$2"
  if [[ $NEED_INSTALL -eq 0 ]]; then
    download_artifact "$channel" "$dest" || return 1
  elif [[ ! -d "$dest" ]]; then
    if [[ -n "$RELEASE_VERSION" ]]; then
      download_artifact "$channel" "$dest" || return 1
    else
      err "No local install and no release."; return 1
    fi
  else
    ok "$channel files ready"
  fi
}

# ---- Channel: Claude Code ----

install_claudecode() {
  section "Claude Code"

  if ! have_command claude; then warn "claude CLI not found. Skipping."; return; fi

  local plugin_dir="$LORE_HOME/claudecode"
  download_or_skip "claudecode" "$plugin_dir" || return

  rm -rf "$HOME/.claude/plugins/cache/lore"
  run_quiet claude plugin marketplace add "$plugin_dir" || true

  if ! claude plugin list 2>/dev/null | grep -q "lore@lore"; then
    run_quiet claude plugin install lore@lore || warn "Claude: install lore@lore manually in /plugin"
  else
    ok "Claude plugin already enabled"
  fi

  # settings.json env (for MCP URL)
  local sf="$HOME/.claude/settings.json"
  if have_command python3; then
    python3 - "$sf" "$BASE_URL" "$API_TOKEN" <<'PY'
import sys, json, os
path, base_url, api_token = sys.argv[1], sys.argv[2], sys.argv[3]
data = {}
if os.path.exists(path):
    try:
        with open(path, 'r') as f: data = json.load(f)
    except: data = {}
if not isinstance(data, dict): data = {}
data.setdefault("env", {})
data["env"]["LORE_BASE_URL"] = base_url
if api_token: data["env"]["LORE_API_TOKEN"] = api_token
with open(path, 'w') as f: json.dump(data, f, indent=2, ensure_ascii=False)
PY
    ok "Claude settings updated"
  fi

  local claude_mcp_url="${BASE_URL}/api/mcp?client_type=claudecode"
  run_quiet claude mcp remove lore || true
  local claude_mcp_configured=0
  if [[ -n "$API_TOKEN" ]]; then
    if run_quiet claude mcp add --transport http --scope user lore "$claude_mcp_url" --header "Authorization: Bearer ${API_TOKEN}"; then
      claude_mcp_configured=1
    else
      warn "Claude: configure Lore MCP manually"
    fi
  else
    if run_quiet claude mcp add --transport http --scope user lore "$claude_mcp_url"; then
      claude_mcp_configured=1
    else
      warn "Claude: configure Lore MCP manually"
    fi
  fi
  if [[ "$claude_mcp_configured" == "1" ]]; then
    ok "Claude MCP configured"
  fi

  # Legacy local guidance is no longer installed; lifecycle context comes from the Lore server.
  local gdst="$HOME/.claude/lore-guidance.md"
  [[ -f "$gdst" ]] && rm -f "$gdst"
  local cmd="$HOME/.claude/CLAUDE.md"
  if [[ -f "$cmd" ]] && grep -Eq '^(@~/.claude/lore-guidance\.md|@import ~/.claude/lore-guidance\.md)$' "$cmd" 2>/dev/null; then
    local tmp="${cmd}.tmp.$$"
    grep -Ev '^(@~/.claude/lore-guidance\.md|@import ~/.claude/lore-guidance\.md)$' "$cmd" > "$tmp"
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' '/./,$!d' "$tmp"
    else
      sed -i '/./,$!d' "$tmp"
    fi
    mv "$tmp" "$cmd"
    ok "Removed legacy Claude guidance import"
  fi

  ok "Claude Code configured"
}

# ---- Channel: Codex ----

install_codex() {
  section "Codex"

  if ! have_command codex; then warn "codex CLI not found. Skipping."; return; fi

  local market_dir="$LORE_HOME/codex"
  download_or_skip "codex" "$market_dir" || return

  local codex_home="${CODEX_HOME:-$HOME/.codex}"
  local installed_plugin_root="$codex_home/plugins/cache/lore/lore/local"
  rm -rf "$installed_plugin_root.tmp"
  mkdir -p "$(dirname "$installed_plugin_root")"
  cp -a "$market_dir/plugins/lore" "$installed_plugin_root.tmp"
  rm -rf "$installed_plugin_root"
  mv "$installed_plugin_root.tmp" "$installed_plugin_root"
  if [[ -f "$installed_plugin_root/hooks/hooks.json" ]] && have_command python3; then
    python3 - "$installed_plugin_root/hooks/hooks.json" "$installed_plugin_root" <<'PY'
import sys
from pathlib import Path
hooks_path = Path(sys.argv[1])
plugin_root = sys.argv[2]
hooks_path.write_text(hooks_path.read_text().replace("__LORE_CODEX_PLUGIN_ROOT__", plugin_root))
PY
  fi

  run_quiet codex plugin marketplace add "$market_dir" || true

  # Enable in config.toml
  local cfg="${CODEX_HOME:-$HOME/.codex}/config.toml"
  if have_command python3 && [[ -f "$cfg" ]]; then
    python3 - "$cfg" <<'PY'
import sys
path = sys.argv[1]
with open(path) as f: lines = f.readlines()
section = '[plugins."lore@lore"]'
out = []; idx = 0; found = False; done_en = False
while idx < len(lines):
    line = lines[idx]
    if line.strip() == section:
        found = True; out.append(line); idx += 1
        while idx < len(lines) and not lines[idx].lstrip().startswith('['):
            if lines[idx].strip().startswith('enabled'):
                out.append('enabled = true\n'); done_en = True
            else: out.append(lines[idx])
            idx += 1
        if not done_en: out.append('enabled = true\n')
        continue
    out.append(line); idx += 1
if not found:
    if out and out[-1] != '\n': out.append('\n')
    out.extend([section + '\n', 'enabled = true\n'])
with open(path, 'w') as f: f.writelines(out)
PY
    ok "Codex plugin enabled"
  fi

  # MCP
  local mcp_url="${BASE_URL}/api/mcp?client_type=codex"
  run_quiet codex mcp remove lore || true
  run_quiet codex mcp add lore --url "$mcp_url" || true
  if have_command python3; then
    python3 - "$cfg" "$mcp_url" "$API_TOKEN" <<'PY'
import json
import sys

path, mcp_url, api_token = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path, encoding='utf-8') as handle:
        lines = handle.read().splitlines()
except FileNotFoundError:
    lines = []

section = '[mcp_servers.lore]'
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
        while idx < len(lines) and not lines[idx].lstrip().startswith('['):
            stripped = lines[idx].strip()
            if stripped.startswith('url'):
                out.append(f'url = {json.dumps(mcp_url)}')
                url_written = True
            elif stripped.startswith('bearer_token_env_var') or stripped.startswith('http_headers') or stripped.startswith('env_http_headers'):
                pass
            else:
                out.append(lines[idx])
            idx += 1
        if not url_written:
            out.append(f'url = {json.dumps(mcp_url)}')
        if api_token:
            out.append(f'http_headers = {{ Authorization = {json.dumps("Bearer " + api_token)} }}')
        continue
    out.append(line)
    idx += 1

if not found:
    if out and out[-1] != '':
        out.append('')
    out.append(section)
    out.append(f'url = {json.dumps(mcp_url)}')
    if api_token:
        out.append(f'http_headers = {{ Authorization = {json.dumps("Bearer " + api_token)} }}')

with open(path, 'w', encoding='utf-8') as handle:
    handle.write('\n'.join(out).rstrip() + '\n')
PY
  fi
  ok "MCP configured"

  # Enable official Codex lifecycle hooks support for plugin-bundled hooks.
  mkdir -p "$(dirname "$cfg")"
  touch "$cfg"
  if have_command python3; then
    python3 - "$cfg" <<'PY'
import sys
path = sys.argv[1]
try:
    with open(path, encoding='utf-8') as f: lines = f.read().splitlines()
except FileNotFoundError:
    lines = []
out = []; idx = 0; found = False
while idx < len(lines):
    line = lines[idx]
    if line.strip() == '[features]':
        found = True; out.append(line); idx += 1; written = False
        while idx < len(lines) and not lines[idx].lstrip().startswith('['):
            stripped = lines[idx].strip()
            if stripped.startswith('hooks') or stripped.startswith('codex_hooks'):
                if not written:
                    out.append('hooks = true'); written = True
            else:
                out.append(lines[idx])
            idx += 1
        if not written: out.append('hooks = true')
        continue
    out.append(line); idx += 1
if not found:
    if out and out[-1] != '': out.append('')
    out.extend(['[features]', 'hooks = true'])
with open(path, 'w', encoding='utf-8') as f: f.write('\n'.join(out).rstrip() + '\n')
PY
    ok "Codex hooks enabled"
  fi

  # Codex 0.130 still does not execute plugin-local hooks at runtime; install user-level hooks
  # as the compatibility path while keeping hooks bundled in the plugin for future Codex versions.
  if [[ -x "$installed_plugin_root/scripts/install-hooks.sh" ]]; then
    LORE_CODEX_PLUGIN_ROOT="$installed_plugin_root" \
      LORE_BASE_URL="${BASE_URL}" \
      LORE_API_TOKEN="${API_TOKEN:-}" \
      bash "$installed_plugin_root/scripts/install-hooks.sh" 2>/dev/null || true
    ok "Codex hooks installed"
  fi

  ok "Codex configured"
}

# ---- Channel: Pi ----

install_pi() {
  section "Pi"

  if ! have_command pi; then warn "pi CLI not found. Skipping."; return; fi

  local pi_dir="$LORE_HOME/pi"
  download_or_skip "pi" "$pi_dir" || return

  LORE_BASE_URL="${BASE_URL}" LORE_API_TOKEN="${API_TOKEN:-}" \
    bash "$pi_dir/scripts/install-local.sh" >/dev/null 2>&1
  ok "Pi configured"
}

# ---- Channel: OpenClaw ----

install_openclaw() {
  section "OpenClaw"

  if ! have_command openclaw; then warn "openclaw CLI not found. Skipping."; return; fi

  local oc_dir="$LORE_HOME/openclaw"
  download_or_skip "openclaw" "$oc_dir" || return

  rm -rf "$HOME/.openclaw/extensions/lore"
  (
    cd "$oc_dir"
    npm install --silent >/dev/null 2>&1 || npm install --silent >/dev/null 2>&1
    npm run build >/dev/null 2>&1 || true
    run_quiet openclaw plugins install . --force --dangerously-force-unsafe-install || true
    run_quiet openclaw plugins enable lore || true
  )

  local occ="$HOME/.openclaw/openclaw.json"
  if [[ -f "$occ" ]] && have_command python3; then
    python3 - "$occ" "$BASE_URL" "$API_TOKEN" <<'PY'
import sys, json
path, base_url, api_token = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path) as f: data = json.load(f)
except: data = {}
data.setdefault("plugins",{}).setdefault("entries",{}).setdefault("lore",{})
lore = data["plugins"]["entries"]["lore"]
lore.setdefault("config",{})
lore["config"]["baseUrl"] = base_url
if api_token: lore["config"]["apiToken"] = api_token
lore.setdefault("enabled", True)
with open(path, 'w') as f: json.dump(data, f, indent=2, ensure_ascii=False)
PY
    ok "OpenClaw config updated"
  fi
  ok "OpenClaw configured"
}

# ---- Channel: Hermes ----

install_hermes() {
  section "Hermes"

  local plugin_dir="$LORE_HOME/hermes"
  download_or_skip "hermes" "$plugin_dir" || return

  ok "Hermes files ready"
  info "Hermes: symlink ${plugin_dir}/lore_memory into your Hermes plugin path"
}

# ---- Main ----

main() {
  if [[ "$SHOW_HELP" == "1" ]]; then
    print_usage
    return
  fi

  banner

  resolve_channels
  start_docker

  # Ensure BASE_URL is set
  BASE_URL="${BASE_URL:-$DEFAULT_BASE_URL}"
  BASE_URL="${BASE_URL%/}"
  if [[ -z "${_EXPLICIT_API_TOKEN:-}" && -z "$API_TOKEN" ]]; then
    API_TOKEN="$(read_config_token)"
  fi

  local channel_label="stable"
  [[ "$CHECK_DEV" == "1" ]] && channel_label="dev"
  [[ "$CHECK_PRE" == "1" ]] && channel_label="pre-release"
  info "Server: ${BASE_URL}"
  info "Channels: $(IFS=,; echo "${CHANNELS[*]}") (${channel_label})"

  check_release || true
  write_config 0

  for ch in "${CHANNELS[@]}"; do
    case "$ch" in
      claudecode) install_claudecode;;
      codex)      install_codex;;
      pi)         install_pi;;
      openclaw)   install_openclaw;;
      hermes)     install_hermes;;
      *)          warn "Unknown channel: $ch";;
    esac
  done

  write_config 1

  echo ""
  ok "Install complete (${RELEASE_VERSION:-unknown})"
  info "Config: $LORE_CONFIG_FILE"
  info "Setup: ${BASE_URL}/setup"
  msg_restart
}

main "$@"

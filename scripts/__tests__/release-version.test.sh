#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file_version() {
  local file="$1" expected="$2"
  python3 - "$file" "$expected" <<'PY'
import json, sys
path, expected = sys.argv[1], sys.argv[2]
with open(path, encoding='utf-8') as handle:
    data = json.load(handle)
assert data['version'] == expected, (path, data.get('version'))
PY
}

assert_lock_root_version() {
  local file="$1" expected="$2"
  python3 - "$file" "$expected" <<'PY'
import json, sys
path, expected = sys.argv[1], sys.argv[2]
with open(path, encoding='utf-8') as handle:
    data = json.load(handle)
assert data['version'] == expected
assert data['packages']['']['version'] == expected
PY
}

assert_opencode_lock_version() {
  local file="$1" expected="$2"
  python3 - "$file" "$expected" <<'PY'
import json, sys
path, expected = sys.argv[1], sys.argv[2]
with open(path, encoding='utf-8') as handle:
    data = json.load(handle)
assert data['version'] == expected
assert data['packages']['']['version'] == expected
assert data['packages']['']['dependencies']['@opencode-ai/plugin'] == '1.18.3'
assert data['packages']['node_modules/@opencode-ai/plugin']['version'] == '1.18.3'
assert data['packages']['node_modules/@opencode-ai/sdk']['version'] == '1.18.3'
PY
}

make_fixture_repo() {
  local dest="$1"
  mkdir -p "$dest/scripts" "$dest/web/server" "$dest/cli" "$dest/claudecode-plugin/.claude-plugin" \
    "$dest/codex-plugin/.codex-plugin" "$dest/openclaw-plugin" "$dest/pi-extension" \
    "$dest/hermes-plugin/lore_memory" "$dest/opencode-plugin"
  cp "$ROOT/scripts/release.sh" "$dest/scripts/release.sh"
  cp "$ROOT/web/package.json" "$ROOT/web/package-lock.json" "$dest/web/"
  cp "$ROOT/cli/package.json" "$ROOT/cli/package-lock.json" "$dest/cli/"
  cp "$ROOT/web/server/mcpServer.ts" "$dest/web/server/mcpServer.ts"
  cp "$ROOT/claudecode-plugin/.claude-plugin/plugin.json" "$dest/claudecode-plugin/.claude-plugin/plugin.json"
  cp "$ROOT/claudecode-plugin/.claude-plugin/marketplace.json" "$dest/claudecode-plugin/.claude-plugin/marketplace.json"
  cp "$ROOT/codex-plugin/.codex-plugin/plugin.json" "$dest/codex-plugin/.codex-plugin/plugin.json"
  cp "$ROOT/openclaw-plugin/openclaw.plugin.json" "$ROOT/openclaw-plugin/package.json" \
    "$ROOT/openclaw-plugin/package-lock.json" "$dest/openclaw-plugin/"
  cp "$ROOT/pi-extension/package.json" "$dest/pi-extension/package.json"
  cp "$ROOT/hermes-plugin/lore_memory/plugin.yaml" "$dest/hermes-plugin/lore_memory/plugin.yaml"
  cp "$ROOT/opencode-plugin/package.json" "$ROOT/opencode-plugin/package-lock.json" "$dest/opencode-plugin/"
}

make_fake_git() {
  local bin="$1" log="$2"
  mkdir -p "$bin"
  cat > "$bin/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_GIT_LOG"
case "${1:-}" in
  diff) exit 0 ;;
  *) exit 0 ;;
esac
SH
  chmod +x "$bin/git"
  : > "$log"
}

PREP_REPO="$TMP/prepare"
PREP_BIN="$TMP/prepare-bin"
PREP_LOG="$TMP/prepare-git.log"
make_fixture_repo "$PREP_REPO"
make_fake_git "$PREP_BIN" "$PREP_LOG"
(
  cd "$PREP_REPO"
  PATH="$PREP_BIN:/opt/homebrew/bin:/usr/bin:/bin" FAKE_GIT_LOG="$PREP_LOG" \
    bash scripts/release.sh --prepare-only 9.8.7-pre.1 > "$TMP/prepare.out"
)
assert_file_version "$PREP_REPO/cli/package.json" '9.8.7-pre.1'
assert_lock_root_version "$PREP_REPO/cli/package-lock.json" '9.8.7-pre.1'
assert_file_version "$PREP_REPO/opencode-plugin/package.json" '9.8.7-pre.1'
assert_opencode_lock_version "$PREP_REPO/opencode-plugin/package-lock.json" '9.8.7-pre.1'
if grep -Eq '^(commit|tag|push)( |$)' "$PREP_LOG"; then
  fail "prepare-only invoked commit/tag/push"
fi
grep -Fq 'prepared, not committed/tagged/pushed' "$TMP/prepare.out" || fail "prepare-only confirmation missing"

NORMAL_REPO="$TMP/normal"
NORMAL_BIN="$TMP/normal-bin"
NORMAL_LOG="$TMP/normal-git.log"
make_fixture_repo "$NORMAL_REPO"
make_fake_git "$NORMAL_BIN" "$NORMAL_LOG"
(
  cd "$NORMAL_REPO"
  PATH="$NORMAL_BIN:/opt/homebrew/bin:/usr/bin:/bin" FAKE_GIT_LOG="$NORMAL_LOG" \
    bash scripts/release.sh 9.8.7-pre.1 > "$TMP/normal.out"
)
assert_file_version "$NORMAL_REPO/cli/package.json" '9.8.7-pre.1'
assert_lock_root_version "$NORMAL_REPO/cli/package-lock.json" '9.8.7-pre.1'
assert_file_version "$NORMAL_REPO/opencode-plugin/package.json" '9.8.7-pre.1'
assert_opencode_lock_version "$NORMAL_REPO/opencode-plugin/package-lock.json" '9.8.7-pre.1'
grep -Fq 'commit -m release: v9.8.7-pre.1' "$NORMAL_LOG" || fail "normal release did not commit"
grep -Fq 'tag v9.8.7-pre.1' "$NORMAL_LOG" || fail "normal release did not tag"
[[ $(grep -c '^push' "$NORMAL_LOG") -eq 2 ]] || fail "normal release did not push branch and tags"

echo "release version tests passed"

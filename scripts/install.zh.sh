#!/usr/bin/env bash
set -euo pipefail

# Legacy frozen installer. Prefer: npx @loremem/cli
# This script is kept for compatibility and is no longer updated with new features.

export LORE_INSTALL_LANG=zh

SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
fi

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/install.sh" ]]; then
  exec bash "$SCRIPT_DIR/install.sh" "$@"
fi

curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.sh | bash -s -- "$@"

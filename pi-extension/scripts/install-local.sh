#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-${HOME}/.pi/agent}"
TARGET_DIR="${PI_AGENT_DIR}/extensions/lore"

mkdir -p "$(dirname "${TARGET_DIR}")"
if [ -L "${TARGET_DIR}" ] || [ ! -e "${TARGET_DIR}" ]; then
  ln -sfn "${PLUGIN_DIR}" "${TARGET_DIR}"
else
  echo "Target exists and is not a symlink: ${TARGET_DIR}" >&2
  echo "Move it aside or remove it before installing Lore Pi extension." >&2
  exit 1
fi

echo "Installed Lore Pi extension:"
echo "  ${TARGET_DIR} -> ${PLUGIN_DIR}"
echo "Run /reload inside Pi, or restart pi."

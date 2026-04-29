#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
HOOK_ROOT="$CODEX_HOME/hooks/lore"
HOOKS_JSON="$CODEX_HOME/hooks.json"

mkdir -p "$HOOK_ROOT/hooks" "$HOOK_ROOT/rules"
cp "$PLUGIN_ROOT/hooks/rules-inject.ts" "$HOOK_ROOT/hooks/rules-inject.ts"
cp "$PLUGIN_ROOT/hooks/recall-inject.ts" "$HOOK_ROOT/hooks/recall-inject.ts"
cp "$PLUGIN_ROOT/rules/lore-guidance.md" "$HOOK_ROOT/rules/lore-guidance.md"

if [[ -f "$HOOKS_JSON" ]]; then
  cp "$HOOKS_JSON" "$HOOKS_JSON.bak.$(date +%Y%m%d%H%M%S)"
fi

export LORE_CODEX_HOOK_ROOT="$HOOK_ROOT"
export LORE_CODEX_HOOKS_JSON="$HOOKS_JSON"

node <<'NODE'
const fs = require('node:fs');
const hooksJson = process.env.LORE_CODEX_HOOKS_JSON;
const hookRoot = process.env.LORE_CODEX_HOOK_ROOT;

let data = { hooks: {} };
if (fs.existsSync(hooksJson)) {
  const raw = fs.readFileSync(hooksJson, 'utf8').trim();
  if (raw) data = JSON.parse(raw);
}
if (!data || typeof data !== 'object' || Array.isArray(data)) data = { hooks: {} };
if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) data.hooks = {};

const commandFor = (script) =>
  `LORE_CODEX_PLUGIN_ROOT="${hookRoot}" LORE_BASE_URL=\${LORE_BASE_URL:-http://127.0.0.1:18901} npx tsx "${hookRoot}/hooks/${script}"`;

const entries = {
  SessionStart: {
    matcher: "",
    hooks: [{ type: "command", command: commandFor('rules-inject.ts'), timeout: 10 }],
  },
  UserPromptSubmit: {
    matcher: "",
    hooks: [{ type: "command", command: commandFor('recall-inject.ts'), timeout: 10 }],
  },
};

for (const [eventName, entry] of Object.entries(entries)) {
  const current = Array.isArray(data.hooks[eventName]) ? data.hooks[eventName] : [];
  const filtered = current.filter((item) => {
    const commands = Array.isArray(item?.hooks) ? item.hooks.map((hook) => String(hook?.command || '')) : [];
    return !commands.some((command) => command.includes('/hooks/lore/hooks/rules-inject.ts') || command.includes('/hooks/lore/hooks/recall-inject.ts'));
  });
  filtered.push(entry);
  data.hooks[eventName] = filtered;
}

fs.mkdirSync(require('node:path').dirname(hooksJson), { recursive: true });
fs.writeFileSync(hooksJson, JSON.stringify(data, null, 2) + '\n');
NODE

echo "Installed Lore Codex hooks into $HOOKS_JSON"
echo "Restart Codex for hook changes to take effect."

# Lore Codex Plugin

Lore gives Codex MCP tools for fixed boot memory, recall search, durable memory writes, and session read tracking.

## Install the Marketplace

```bash
codex plugin marketplace add FFatTiger/lore --ref plugin
```

Restart Codex, open the plugin directory, select the Lore marketplace, and enable Lore.

## Local Server

Start Lore before using the plugin:

```bash
docker compose up -d
export LORE_BASE_URL=http://127.0.0.1:18901
```

The plugin MCP config points Codex to:

```text
${LORE_BASE_URL:-http://127.0.0.1:18901}/api/mcp?client_type=codex
```

If Lore is protected by `API_TOKEN`, configure Codex MCP with the official Streamable HTTP bearer-token flag:

```bash
export LORE_API_TOKEN="$API_TOKEN"
codex mcp add lore --url "$LORE_BASE_URL/api/mcp?client_type=codex" --bearer-token-env-var LORE_API_TOKEN
```

## Optional Prompt Injection

Codex discovers hooks from `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, or `<repo>/.codex/config.toml`. Plugin install is not treated as automatic hook enablement here.

To install Lore's Codex hooks explicitly from this plugin source tree:

```bash
./scripts/install-hooks.sh
```

The hooks add:

- `SessionStart`: Lore guidance plus boot baseline from `client_type=codex`
- `UserPromptSubmit`: `<recall>` context for the current prompt

# Lore Codex Plugin

Lore gives Codex MCP tools for fixed boot memory, recall search, durable memory writes, and session read tracking.

## One-Command Install

```bash
export LORE_BASE_URL=http://127.0.0.1:18901
./scripts/install.sh
```

The installer stages the official Codex marketplace layout under `~/.codex/plugins/lore-local-marketplace`, registers the marketplace, enables `lore@lore`, configures the Lore MCP server, and installs the optional Codex hooks.

Restart Codex after the script finishes.

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
./scripts/install.sh
```

The installer uses `LORE_API_TOKEN` when present, then `API_TOKEN`, and writes the matching bearer-token env var into Codex MCP config.

## Optional Prompt Injection

Codex discovers hooks from `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, or `<repo>/.codex/config.toml`. Plugin install is not treated as automatic hook enablement here.

The one-command installer runs the hook installer automatically. To refresh only hooks:

```bash
./scripts/install-hooks.sh
```

The hooks add:

- `SessionStart`: Lore guidance plus boot baseline from `client_type=codex`
- `UserPromptSubmit`: `<recall>` context for the current prompt

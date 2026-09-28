# Lore Codex Plugin

Lore gives Codex MCP tools for fixed boot memory, recall search, durable memory writes, and recall adoption tracking.

## One-Command Install

```bash
mkdir -p ~/.lore
cat > ~/.lore/config.json <<'JSON'
{
  "base_url": "http://127.0.0.1:18901",
  "api_token": "YOUR_TOKEN_IF_USED"
}
JSON
./scripts/install.sh
```

The installer stages the official Codex marketplace layout, registers the marketplace, enables `lore@lore`, enables Codex lifecycle hooks, and configures two MCP servers:

- `lore` — remote HTTP MCP for memory tools
- `lore-skills` — local stdio MCP (`local-skills-mcp`) for all `lore_skill_*` tools (list/search/get/create/update/delete/status)

Lore hooks are bundled in the plugin manifest (`hooks/hooks.json`) rather than installed as user-level `~/.codex/hooks.json` entries.

Restart Codex after the script finishes. If Codex reports that hooks need review, open `/hooks` and trust the Lore user hooks.

## Local Server

Start Lore before using the plugin:

```bash
docker compose up -d
```

The plugin MCP config registers:

```text
lore        → ${LORE_BASE_URL:-http://127.0.0.1:18901}/api/mcp?client_type=codex
lore-skills → node <plugin>/local-skills-mcp/src/server.mjs --client-type codex
```

Shared connection settings come from `~/.lore/config.json` (and env). The local skills server reads `LORE_HOME` / `LORE_BASE_URL` / `LORE_API_TOKEN` from the environment or that file — tokens are never placed in the MCP command string.

```json
{
  "base_url": "http://127.0.0.1:18901",
  "api_token": "YOUR_TOKEN_IF_USED"
}
```

The installer configures remote `lore` MCP with a standard `Authorization: Bearer ...` HTTP header (or env-backed auth) and registers local `lore-skills` as a stdio command pointing into the installed plugin artifact.

## Prompt Injection Hooks

Lore ships plugin-bundled lifecycle hooks through `hooks/hooks.json`, referenced by `.codex-plugin/plugin.json`. Modern Codex builds execute those plugin hooks directly. The installer enables the official Codex hooks feature in `~/.codex/config.toml` and removes older Lore user-level hook entries from `~/.codex/hooks.json` so one prompt creates one recall query:

```toml
[features]
hooks = true
```

Set `LORE_CODEX_INSTALL_USER_HOOKS=1` only for legacy Codex builds that require `~/.codex/hooks.json` compatibility entries.

The hooks add:

- `SessionStart`: server-returned Lore boot lifecycle context from `client_type=codex`
- `UserPromptSubmit`: `<recall>` / Memory host output, plus any lifecycle `skill_candidates` appended in a `<lore-skills>` block (discovery only; call `lore_skill_get` to fetch a local copy)

Hook commands run plain `node` `.mjs` files instead of `npx tsx`, avoiding per-prompt package runner startup cost.

# Lore ZCode plugin

Official ZCode plugin for Lore: an MCP bridge for Lore memory tools plus bundled lifecycle hooks. No ZCode runtime changes are required.

## Install from this directory

```bash
zcode plugins marketplace add /absolute/path/to/lore/zcode-plugin
zcode plugins install lore@lore
zcode plugins enable lore@lore
```

Or with the Lore CLI after a release artifact exists:

```bash
npx @loremem/cli install --channels zcode
```

The plugin reads `${LORE_HOME:-~/.lore}/config.json` (`base_url`, `api_token`), then `LORE_BASE_URL` / `LORE_API_TOKEN` / `API_TOKEN`. The default server is `http://127.0.0.1:18901`. The token is never placed in the plugin manifest or command arguments.

## MCP

`.mcp.json` declares one stdio server named `lore` that forwards MCP JSON-RPC to the server's `/api/mcp?client_type=zcode`. Its tools appear under ZCode's `mcp__plugin_lore_lore__<tool>` namespace.

## Hooks

- `SessionStart` (`startup|resume|clear`, 8000ms): inject Lore boot context, then hand the skills sync to a detached background process
- `UserPromptSubmit` (10000ms): inject Lore recall context for non-empty prompts

Lore/network/parse errors fail open: the hooks exit 0 with empty stdout.

## Skills

Skills are fail-closed. They are enabled only when the connected server advertises `capabilities.skills=true`, which the installer records as `server_profile` in `config.json` for the same base URL. `LORE_SKILLS_ENABLED=0` forces them off; `LORE_SKILLS_ENABLED=1` enables them when no matching profile exists.

When Skills are enabled, every `SessionStart` syncs the visible skills into the plugin's own `skills/` directory (`skills/<name>/SKILL.md`) in a detached background process, so ZCode discovers them natively. The hook exits without waiting for the sync; the last outcome is recorded in `skills/.lore-sync-status.json` inside the plugin root. New or changed skills appear after a refresh in Settings → Skills (enabling or disabling the plugin refreshes automatically). Invoke a skill by typing `$` to pick one, or via the `/` menu's Skills group.

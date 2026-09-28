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

- `SessionStart` (`startup|resume|clear`, 8000ms): inject Lore boot context
- `UserPromptSubmit` (10000ms): inject Lore recall context for non-empty prompts

Lore/network/parse errors fail open: the hooks exit 0 with empty stdout.

## Skills

Skills are fail-closed. They are enabled only when the connected server advertises `capabilities.skills=true`, which the installer records as `server_profile` in `config.json` for the same base URL. `LORE_SKILLS_ENABLED=0` forces them off; `LORE_SKILLS_ENABLED=1` enables them when no matching profile exists. The open-source Lore server has no Skills, so its users never see `lore_skill_*` tools or Skills context.

When Skills are enabled:

- Session start lists the available skills (name, description, `skill_id`); the agent decides when to call `lore_skill_get`.
- Type `$skill-name` in a prompt to invoke a skill explicitly. Skills whose `SKILL.md` sets `disable-model-invocation: true` are hidden from the agent and only run this way.
- A successful `lore_skill_get` is validated and synchronized to `${LORE_HOME:-~/.lore}/skill-artifacts/<project-id>/<skill-name>/`. The bridge returns the `SKILL.md` text, local directory, version, and managed file list. Server-managed files are tracked in `.lore-skill-marker.json`; a later get restores modified managed files and removes managed files retired by the server, while extra local files are preserved as agent outputs. Path traversal, symlinks, hash mismatches, malformed base64, and collisions with local outputs fail before the work copy is changed.

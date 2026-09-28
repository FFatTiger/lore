# Lore for OpenCode

Native OpenCode plugin bundle for Lore memory and Skills.

## Install

The standard Lore installer places `lore-memory.js` at:

```text
~/.config/opencode/plugins/lore-memory.js
```

Configuration is shared through `~/.lore/config.json` using `base_url` and `api_token`.
The installer does not add an OpenCode MCP server; the plugin registers the exact native `lore_*` tools.

When another OpenCode plugin imports Claude Code compatibility data, Lore uses two layers to prevent duplication:

1. The native plugin suppresses duplicate Lore MCP entries such as `lore` and `lore:lore` after OpenCode merges runtime config.
2. The installer detects an existing user-level `oh-my-openagent.json[c]` or legacy `oh-my-opencode.json[c]` and, only when it can parse the file safely, sets `claude_code.plugins_override["lore@lore"] = false`. This prevents the compatibility layer from importing the Claude Lore lifecycle hooks before the native plugin starts.

The compatibility edit preserves unrelated settings and JSONC comments, records the previous value under `~/.lore/`, and restores the previous value during OpenCode uninstall. Lore does not modify Claude Code files. If the third-party file is missing, unsafe, or unparseable, the installer warns and skips it instead of creating or overwriting it.

Set `LORE_OPENCODE_ALLOW_MCP=1` when running the installer and starting OpenCode only when you explicitly need the legacy generic MCP fallback alongside the native plugin. Re-running the installer with this escape hatch restores any compatibility value previously changed by Lore.

This bundle is built against `@opencode-ai/plugin@1.18.3`.

## Skills

OpenCode registers native `lore_skill_list/search/get/create/update/delete/status` tools. Session start lists the skills the agent may use (name, description, `skill_id`); the agent decides when to call `lore_skill_get`. Users can invoke a skill explicitly by typing `$skill-name` in a prompt; skills whose `SKILL.md` sets `disable-model-invocation: true` are hidden from the agent and only run this way. Neither lifecycle event downloads or reconciles copies. `lore_skill_get(skill_id)` downloads the complete server Skill package into a local work copy under `~/.lore/skill-artifacts/<project-id>/<skill-name>/` when missing, updates managed package files when the server version differs, and reuses the local copy when the version matches, then returns `SKILL.md` and the absolute directory. Server-managed package files are read-only; the skill directory itself stays writable so agents can create local outputs directly inside the same copy. Extra local files are never uploaded and survive fetches and version upgrades; only a managed-file modification triggers a restore. All download/update is on-demand via `lore_skill_get`.

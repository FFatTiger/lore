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

OpenCode registers native `lore_skill_list/search/get/create/update/delete/status` tools. Prompt lifecycle only adds discovery candidates. `lore_skill_get(skill_id)` downloads the complete Skill package into a writable work copy under `~/.lore/skill-artifacts/<project-id>/<skill-name>/` when missing or when its server version changes, then returns `SKILL.md` and the absolute directory. Same-version local edits and outputs are preserved; server upgrades replace only managed paths. There is no separate Artifact tool.

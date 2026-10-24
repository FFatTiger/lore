# Lore for OpenClaw

OpenClaw plugin for Lore Memory and Skills.

The plugin registers Memory tools, boot/recall lifecycle hooks, and Skill management tools:

```text
lore_skill_list
lore_skill_search
lore_skill_create
lore_skill_update
lore_skill_delete
lore_skill_import
```

The manifest's `"skills": ["skills"]` entry registers the plugin's own `skills/` directory as a native OpenClaw skill source. At every session start the plugin syncs the visible Lore skills into that directory in the background (fire-and-forget; failures stay debug-level), and OpenClaw watches the directory and hot-loads new and changed skills without a restart. The sync's last outcome is recorded in `skills/.lore-sync-status.json` inside the plugin root (`~/.openclaw/extensions/lore` when installed by the Lore CLI). Changes made with the tools above are server-side: they sync to the local directory when the next session starts.

Each skill's `SKILL.md` `name` becomes a slash command, invoked by typing `/name`. Skills whose `SKILL.md` sets `disable-model-invocation: true` are hidden from the model and only run when the user invokes them explicitly; `user-invocable: false` hides a skill from the user instead.

Skill updates use positive integer `expected_version`.

Configuration is read from the OpenClaw plugin entry, `LORE_HOME`, and `~/.lore/config.json`.

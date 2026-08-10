# Lore for OpenClaw

OpenClaw plugin for Lore Memory and Skills.

The plugin registers Memory tools, boot/recall lifecycle hooks, and native Skill tools:

```text
lore_skill_list
lore_skill_search
lore_skill_get
lore_skill_create
lore_skill_update
lore_skill_delete
lore_skill_status
```

Skill recall is discovery-only. When a candidate is relevant, the agent calls `lore_skill_get(skill_id)`. The plugin downloads the complete package into a writable work copy at:

```text
${LORE_HOME:-~/.lore}/skill-artifacts/<project-id>/<skill-name>/
```

The tool returns the full `SKILL.md` content and absolute `skill_dir`. Same-version local edits and generated outputs are preserved. When the server version changes, only server-managed files are refreshed or removed; additional local files remain in the work copy. Skill updates use positive integer `expected_version`. There is no separate Artifact directory or Artifact tool.

Configuration is read from the OpenClaw plugin entry, `LORE_HOME`, and `~/.lore/config.json`.

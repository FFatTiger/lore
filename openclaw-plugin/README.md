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

Session start lists the skills the agent may use (name, description, `skill_id`); the agent decides when to call `lore_skill_get`. Users can invoke a skill explicitly by typing `$skill-name` in a prompt; skills whose `SKILL.md` sets `disable-model-invocation: true` are hidden from the agent and only run this way. Lore never injects local paths. Downloads are on-demand: there is no session-start sync or reconcile. `lore_skill_get` downloads the complete server package when missing, updates the server-managed package files when the server version differs, and reuses the local copy when the version matches and managed files are intact.

Local work copies live directly under:

```text
${LORE_HOME:-~/.lore}/skill-artifacts/<project-id>/<skill-name>/
```

Server-managed package files are read-only (0444 on POSIX), while the skill directory itself stays writable (0755) so agents can create local outputs, artifacts, and cache files directly inside the same copy. Extra local files never trigger tamper and survive fetches and version upgrades; same-version local outputs are preserved across fetches and upgrades. A version mismatch updates the managed package files while preserving local outputs. There is no separate artifact directory and no `lore_skill_artifact_create` tool.

The tool returns the full `SKILL.md` content and absolute `skill_dir`. Skill updates use positive integer `expected_version`.

Configuration is read from the OpenClaw plugin entry, `LORE_HOME`, and `~/.lore/config.json`.

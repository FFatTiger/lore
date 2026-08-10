# Lore Pi Extension

This extension connects Pi agent to Lore long-term memory.

## Capabilities

- Registers Lore tools with `pi.registerTool`.
- Adds `client_type=pi` to Lore API requests.
- Injects Lore boot guidance through `before_agent_start`.
- Injects per-prompt recall context as a hidden custom message.
- Tracks session reads for `lore_get_node`.
- Registers server-side Skill CRUD/search/status tools without prescribing when the agent should use them.
- Lifecycle Skill recall discovers matching Skill candidates only (skill_id, name, description, version). It does not auto-download, reconcile, or inject local paths.
- `lore_skill_get(skill_id)` materializes a complete writable local work copy at `~/.lore/skill-artifacts/<project-id>/<skill-name>/` (or `LORE_HOME`) when missing or when the server version differs.
- Same-version work copies preserve all local Agent edits and outputs; server version upgrades replace only server-managed paths and prune obsolete managed files.
- Transport validation covers safe paths, required `SKILL.md`, per-file hashes/sizes, and optional manifest hashes. Unmanaged local directories are never overwritten.
- Skill outputs live inside the writable work copy directory (no separate artifact tree).

## Local Install

```bash
./pi-extension/scripts/install-local.sh
```

Then run `/reload` inside Pi or restart Pi.

Pi discovers extensions from `~/.pi/agent/extensions/*/index.ts`.

Writable Skill work copies are editable in place. Console or agent tools update the canonical server Skill; a later `lore_skill_get` refreshes the local work copy only when the server version differs. Pi's native `/skill` inventory may require `/reload` or restart after a newly materialized Skill appears; Lore returns the absolute `skill_dir` and `SKILL.md` content immediately from `lore_skill_get`.

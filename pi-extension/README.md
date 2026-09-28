# Lore Pi Extension

This extension connects Pi agent to Lore long-term memory.

## Capabilities

- Registers Lore tools with `pi.registerTool`.
- Adds `client_type=pi` to Lore API requests.
- Injects Lore boot guidance through `before_agent_start`.
- Injects per-prompt recall context as a hidden custom message.
- Tracks session reads for `lore_get_node`.
- Registers server-side Skill CRUD/search/status tools without prescribing when the agent should use them.
- Lifecycle Skill recall discovers matching Skill candidates only (skill_id, name, description, version). It does not inject local paths. Session start records catalog project identity only; all download/update is on-demand via `lore_skill_get` (no session-start sync).
- `lore_skill_get(skill_id)` downloads the complete server package into a local work copy at `~/.lore/skill-artifacts/<project-id>/<skill-name>/` (or `LORE_HOME`) when missing, updates the server-managed package files when the server version differs, and reuses the local copy when the version matches.
- Managed package files are read-only (0444 POSIX) while the skill directory itself stays writable (0755), so agents create local outputs/cache directly inside the same copy. Extra local files never trigger tamper and survive fetches and version upgrades.
- Same-version local outputs are preserved across fetches and upgrades; a version mismatch updates only the server-managed package files.
- Transport validation covers safe paths, required `SKILL.md`, per-file hashes/sizes, and optional manifest hashes. Unmanaged local directories are never overwritten.

## Local Install

```bash
./pi-extension/scripts/install-local.sh
```

Then run `/reload` inside Pi or restart Pi.

Pi discovers extensions from `~/.pi/agent/extensions/*/index.ts`.

Skill work copies keep the server-managed package files read-only while the directory stays writable for local outputs; the next `lore_skill_get` refreshes managed package files on a version change (no session-start sync). Pi's native `/skill` inventory may require `/reload` or restart after a newly materialized Skill appears; Lore returns the absolute `skill_dir` and `SKILL.md` content immediately from `lore_skill_get`.

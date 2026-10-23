# Lore Pi Extension

This extension connects Pi agent to Lore long-term memory.

## Capabilities

- Registers Lore tools with `pi.registerTool`.
- Adds `client_type=pi` to Lore API requests.
- Injects Lore boot guidance through `before_agent_start`.
- Injects per-prompt recall context as a hidden custom message.
- Tracks session reads for `lore_get_node`.
- Registers server-side Skill CRUD/search/status tools without prescribing when the agent should use them.
- When Skills are enabled, session start (`resources_discover`) registers Lore's work-copy directory `~/.lore/skills/<project-id>/` (or `LORE_HOME`) as a native Pi skill directory — no separate copy — and reconciles it with the server catalog in a background sync. Skills appear as regular Pi skills: users invoke them with `/skill:name`, and `disable-model-invocation: true` is honored by Pi natively. The previous sync's skills are visible in the current session; newly synced skills become available in the next session or after `/reload`. The last sync outcome is recorded in `~/.lore/skills/<project-id>/.lore-sync-status.json`.
- `lore_skill_get(skill_id)` downloads the complete server package into a local work copy at `~/.lore/skills/<project-id>/<skill-name>/` (or `LORE_HOME`) when missing, updates the server-managed package files when the server version differs, and reuses the local copy when the version matches.
- Managed package files are read-only (0444 POSIX) while the skill directory itself stays writable (0755), so agents create local outputs/cache directly inside the same copy. Extra local files never trigger tamper and survive fetches and version upgrades.
- Same-version local outputs are preserved across fetches and upgrades; a version mismatch updates only the server-managed package files.
- Transport validation covers safe paths, required `SKILL.md`, per-file hashes/sizes, and optional manifest hashes. Unmanaged local directories are never overwritten.

## Local Install

```bash
./pi-extension/scripts/install-local.sh
```

Then run `/reload` inside Pi or restart Pi.

Pi discovers extensions from `~/.pi/agent/extensions/*/index.ts`.

Skill work copies keep the server-managed package files read-only while the directory stays writable for local outputs; the next `lore_skill_get` or background sync refreshes managed package files on a version change. `lore_skill_get` and the native skill directory share the same `~/.lore/skills/<project-id>/` layout (identical markers), so a skill fetched on demand is picked up by the next session's `/skill` inventory; `lore_skill_get` still returns the absolute `skill_dir` and `SKILL.md` content immediately.

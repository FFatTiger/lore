# Lore Pi Extension

This extension connects Pi agent to Lore long-term memory.

## Capabilities

- Registers Lore tools with `pi.registerTool`.
- Adds `client_type=pi` to Lore API requests.
- Injects Lore boot guidance through `before_agent_start`.
- Injects per-prompt recall context as a hidden custom message.
- Tracks session reads for `lore_get_node`.
- Registers server-side Skill CRUD/search/status tools without prescribing when the agent should use them.
- Reconciles enabled Skill revisions into project-scoped, read-only mirrors under `~/.lore/skills/<project-id>/installed/` (or `LORE_HOME`).
- Verifies Skill identity, version, revision, manifest, file hashes, and local path integrity before adding a matched `SKILL.md` path to hidden recall context.
- Creates writable, local-only Skill artifact directories under `~/.lore/skill-artifacts/`; artifacts are never uploaded by the extension.

## Local Install

```bash
./pi-extension/scripts/install-local.sh
```

Then run `/reload` inside Pi or restart Pi.

Pi discovers extensions from `~/.pi/agent/extensions/*/index.ts`.

Managed Skill mirrors are not editable in place. Console or agent tools update the canonical server Skill, Core creates a new revision, and the extension replaces the verified local mirror atomically. Pi's native `/skill` inventory may require `/reload` or restart after a newly synchronized Skill appears; Lore can still provide its verified absolute `SKILL.md` path immediately through prompt recall.

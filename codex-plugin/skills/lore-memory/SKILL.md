---
name: lore-memory
description: Use when Codex should load Lore boot memory, recall durable context, or write long-term memory through Lore MCP tools.
---

# Lore Memory

Lore is the long-term memory for this agent. Treat Lore reads as remembering durable context, not as external research.

## Startup

When a task depends on user preferences, project history, agent identity, or durable workflow rules, call `lore_boot` first. In Codex, the boot baseline includes:

- `core://agent`
- `core://soul`
- `preferences://user`
- `core://agent/codex`

## Recall

Before answering on a topic that may have durable context, call `lore_search` with the user's current intent. Read relevant results with `lore_get_node` before using them.

## Writes

Create or update Lore memory when the information should survive this session. Prefer `uri` for reads, updates, deletes, and moves. Use snake_case ASCII path segments.

## Maintenance

Before changing or deleting memory, read the existing node first. Add disclosure text that says when the node should be recalled.

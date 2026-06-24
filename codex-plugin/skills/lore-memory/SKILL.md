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

Create or update Lore memory when the information should survive this session. Prefer `uri` for reads, updates, deletes, and moves. Use stable semantic snake_case ASCII path segments.

Do not append dates, timestamps, or epoch values to ordinary memory paths. Put dates in the content instead. Date suffixes are only valid for explicitly date-archived objects such as `dream_diary_2026_06_24`, `daily_log_2026_06_24`, or `release_2026_06_24`.

A multi-segment path is a semantic memory tree. Every intermediate segment must be a real abstraction parent node with content, disclosure, and glossary. Before moving nodes into a hierarchy, create or update those parent nodes; a string-only path move is incomplete.

Before creating, search or open the likely existing owner node. Prefer updating or merging into an existing stable node. Use `lore_create_node` only for a new long-term semantic object.

## Maintenance

Before changing or deleting memory, read the existing node first. Add disclosure text that says when the node should be recalled.

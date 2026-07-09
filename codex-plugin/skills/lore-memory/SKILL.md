---
name: lore-memory
description: Use when Codex should load Lore boot memory, recall durable context, or write long-term memory through Lore MCP tools.
---

# Lore Memory

Lore is the long-term memory for this agent. Treat Lore reads as remembering durable context, not as external research.

## Startup

When a task depends on user preferences, project history, agent identity, or durable workflow rules, call `lore_guidance` and `lore_boot` first. Detailed usage rules are returned by the Lore server; do not rely on this static skill file for behavioral policy.

## Recall

Before answering on a topic that may have durable context, search Lore and open relevant nodes before using them.

## Writes

Create or update Lore memory when information should survive this session. Prefer server guidance and server-side write policy for exact rules.

## Maintenance

Before changing or deleting memory, read the existing node first.

---
name: lore
version: 1.0.0
description: Long-term memory integration for Hermes Agent using Lore memory system
author: Hermes
tags: [memory, lore, persistence]
---

# Lore Hermes Plugin

Self-hosted long-term memory for Hermes Agent. Integrates with Lore memory system to provide persistent memory across sessions.

## Overview

This plugin gives Hermes **persistent memory that survives session resets**. Instead of losing context between conversations, Hermes can store, retrieve, and maintain structured memories through a clean tool interface.

## Installation

1. Ensure Lore server is running (default: http://127.0.0.1:18901)
2. Install this skill to `~/.hermes/skills/lore/`
3. Set environment variables if needed:
   - `LORE_BASE_URL` - Lore server URL
   - `LORE_API_TOKEN` - API authentication token
   - `LORE_DEFAULT_DOMAIN` - Default memory domain (default: "core")

## Quick Start

```python
from lore_hermes import LoreClient, register_tools

# Initialize client
client = LoreClient()

# Check health
health = client.health()

# Boot memories at session start
boot_data = client.boot()

# Search memories
results = client.search("authentication workflow")

# Create new memory
client.create_node(
    domain="project",
    parent_path="myapp/features",
    content="User authentication uses JWT tokens...",
    priority=1,
    title="auth_system"
)
```

## Available Tools

### Status & Boot

- `lore_status()` - Check Lore server health
- `lore_boot()` - Load core memories at session start

### Memory Operations

- `lore_get_node(uri)` - Read a memory node by URI
- `lore_create_node(content, priority, glossary, ...)` - Create new memory
- `lore_update_node(uri, content, ...)` - Update existing memory
- `lore_delete_node(uri)` - Delete a memory
- `lore_move_node(old_uri, new_uri)` - Rename/move memory

### Search & Recall

- `lore_search(query, domain, limit)` - Keyword search
- `lore_recall(query, session_id)` - Semantic recall for context
- `lore_list_domains()` - List all memory domains

### Session Tracking

- `lore_list_session_reads(session_id)` - Show read nodes
- `lore_clear_session_reads(session_id)` - Reset tracking

## Memory URIs

Memories are organized by domain:

- `core://` - Identity, personality, core rules
- `preferences://` - User preferences
- `project://` - Project knowledge
- `workflow://` - Process documentation
- `learning://` - Accumulated insights

Example: `project://myapp/architecture/database`

## Priority Levels

- `0` - Core identity (always loaded)
- `1` - Key facts (important context)
- `2+` - General knowledge (recalled when relevant)

## Automatic Recall

Use `RecallInjector` for automatic memory injection:

```python
from lore_hermes import RecallInjector

injector = RecallInjector()

# Before processing user message
recall_block = injector.inject_recall(user_message, session_id)
if recall_block:
    # Include in context
    context = f"{recall_block}\n\n{user_message}"
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LORE_BASE_URL` | http://127.0.0.1:18901 | Lore server URL |
| `LORE_API_TOKEN` | "" | API authentication |
| `LORE_TIMEOUT` | 30 | Request timeout (seconds) |
| `LORE_DEFAULT_DOMAIN` | core | Default memory domain |

## License

MIT

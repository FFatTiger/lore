# Lore Hermes Plugin

Long-term memory integration for [Hermes Agent](https://github.com/hermes) using the [Lore](https://github.com/FFatTiger/lore) memory system.

## Features

- **Persistent Memory** - Store and retrieve memories across sessions
- **Automatic Recall** - Semantic memory injection before processing queries
- **Session Tracking** - Track which memories have been read
- **Full CRUD Operations** - Create, read, update, delete memory nodes
- **Search & Discovery** - Keyword and semantic search

## Installation

```bash
# Symlink into Hermes skills directory
cd ~/.hermes/skills/
ln -s /path/to/lore/hermes-plugin lore
```

## Quick Start

Hermes loads Lore as a `MemoryProvider`. Once configured, it automatically:

- Injects **boot memories** into the system prompt at session start
- Runs **recall prefetch** before each user message
- Registers **11 Lore tools** for the agent to use

```python
from lore_memory.client import LoreClient

# Direct client usage (optional)
client = LoreClient()
client.boot()
client.create_node(
    content="JWT-based authentication with refresh tokens",
    priority=1,
    uri="project://myapp/auth_system",
    disclosure="When discussing authentication or security",
    glossary=["jwt", "auth"],
)
```

## Configuration

Connection settings are read from `~/.lore/config.json`:

```json
{
  "base_url": "http://127.0.0.1:18901",
  "api_token": "YOUR_TOKEN_IF_USED"
}
```

Environment variables remain as fallback compatibility:

| Variable | Default | Description |
|----------|---------|-------------|
| `LORE_BASE_URL` | `http://127.0.0.1:18901` | Lore server URL |
| `LORE_API_TOKEN` | - | API token for authentication |
| `LORE_TIMEOUT` | `30` | Request timeout in seconds |
| `LORE_DEFAULT_DOMAIN` | `core` | Default memory domain |

## API Reference

### LoreClient

- `health()` - Check server status
- `boot()` - Load boot memories
- `get_node(uri, nav_only, session_id, query_id)` - Read memory node
- `create_node(content, priority, glossary, uri, domain, parent_path, title, disclosure)` - Create new memory
- `update_node(uri, content, priority, disclosure, glossary_add, glossary_remove)` - Update existing memory
- `delete_node(uri)` - Delete memory
- `move_node(old_uri, new_uri)` - Move or rename a memory node
- `search(query, domain, limit, content_limit)` - Search memories
- `recall(query, session_id, limit, max_items)` - Semantic recall
- `list_domains()` - List all domains
- `mark_recall_used(query_id, session_id, uris)` - Mark recall events as adopted

## Project Structure

```
hermes-plugin/
└── lore_memory/
    ├── __init__.py      # MemoryProvider + tool schemas
    ├── client.py        # HTTP client for Lore API
    ├── formatters.py    # Output formatting
    ├── AGENT_RULES.md   # Agent guidance rules
    └── plugin.yaml      # Plugin manifest
```

## License

MIT

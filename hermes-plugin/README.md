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
# Clone or copy to Hermes skills directory
cd ~/.hermes/skills/
ln -s /path/to/lore/hermes-plugin lore

# Or install as package
cd /path/to/lore/hermes-plugin
pip install -e .
```

## Quick Start

```python
from lore_hermes import LoreClient, RecallInjector

# Initialize
client = LoreClient()
injector = RecallInjector(client)

# Boot at session start
boot_data = client.boot()

# Automatic recall before processing
recall = injector.inject_recall("How does auth work?", session_id="my-session")

# Search memories
results = client.search("authentication")

# Create new memory
client.create_node(
    domain="project",
    parent_path="myapp",
    content="JWT-based authentication with refresh tokens",
    priority=1,
    title="auth_system",
    disclosure="When discussing authentication or security"
)
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LORE_BASE_URL` | `http://127.0.0.1:18901` | Lore server URL |
| `LORE_API_TOKEN` | - | API token for authentication |
| `LORE_TIMEOUT` | `30` | Request timeout in seconds |
| `LORE_DEFAULT_DOMAIN` | `core` | Default memory domain |

## API Reference

### LoreClient

- `health()` - Check server status
- `boot()` - Load core memories
- `get_node(domain, path)` - Read memory node
- `create_node(...)` - Create new memory
- `update_node(...)` - Update existing memory
- `delete_node(domain, path)` - Delete memory
- `search(query, ...)` - Search memories
- `recall(query, ...)` - Semantic recall
- `list_domains()` - List all domains

### RecallInjector

- `inject_recall(message, session_id)` - Get relevant memories
- `mark_read(session_id, uri)` - Mark node as read
- `get_prompt_guidance()` - Get usage guidance

## Project Structure

```
hermes-plugin/
├── lore_hermes/
│   ├── __init__.py      # Package exports
│   ├── client.py        # HTTP client for Lore API
│   ├── tools.py         # Hermes tool definitions
│   ├── formatters.py    # Output formatting
│   └── recall.py        # Automatic recall injection
├── SKILL.md             # Hermes skill manifest
├── setup.py             # Package setup
└── README.md            # This file
```

## License

MIT

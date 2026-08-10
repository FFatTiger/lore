# Lore Hermes Plugin

Long-term memory and Skill work-copy integration for [Hermes Agent](https://github.com/hermes) using the [Lore](https://github.com/FFatTiger/lore) memory system.

## Features

- **Persistent Memory** - Store and retrieve memories across sessions
- **Automatic Recall** - Semantic memory injection before processing queries
- **Session Tracking** - Track which memories have been read
- **Full CRUD Operations** - Create, read, update, delete memory nodes
- **Search & Discovery** - Keyword and semantic search
- **Lore Skills** - List/search/get/create/update/delete skills; materialize writable local work copies on get
- **Skill Discovery** - Lifecycle recall appends discovery-only `<lore-skills>` candidates (no auto-download)

## Installation

```bash
# Symlink into Hermes skills directory
cd ~/.hermes/skills/
ln -s /path/to/lore/hermes-plugin lore
```

## Quick Start

Hermes loads Lore as a `MemoryProvider`. Once configured, it automatically:

- Injects **boot memories** into the system prompt at session start
- Runs **recall prefetch** before each user message (memory context + optional skill candidates)
- Registers **memory + skill tools** for the agent to use

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

# Skills API (client_type=hermes is always sent)
client.list_skills()
client.search_skills("auth")
detail = client.get_skill("skill-id")
```

## Skills workflow

- Lifecycle `prompt.submit` may include top-level `skill_candidates`. Hermes appends a discovery-only `<lore-skills>` block to the recall context. It does **not** auto-download skills or inject local paths. Skill discovery is returned even when memory host context is empty.
- Session start may record project catalog identity (`skill_catalog.project_id`) without downloading.
- `lore_skill_get(skill_id)` materializes a complete writable work copy under `${LORE_HOME:-~/.lore}/skill-artifacts/<project-id>/<skill-name>/` and returns `SKILL.md` plus absolute `skill_dir`.
- Same server version preserves local edits and extra agent outputs.
- Server version upgrades overwrite/delete only server-managed files (tracked in `.lore-skill-marker.json` `managed_files`) and preserve local extras.
- Unmanaged directories, symlinks, and unsafe markers are refused. Failed upgrades roll back via staging.
- `lore_skill_update` requires a positive integer `expected_version` (optimistic concurrency).
- There is no separate artifact tool and no behavioral prompt guidance for when to use skills.

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
| `LORE_HOME` | `~/.lore` | Root for local skill work copies |

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
- `list_skills(include_disabled=True)` - List project skills
- `search_skills(query, limit=None)` - Search/recall skills
- `get_skill(skill_id)` - Fetch skill detail (files + hashes)
- `create_skill(body)` - Create skill on server
- `update_skill(skill_id, body)` - Update skill (`expected_version` required, positive integer)
- `delete_skill(skill_id)` - Archive/delete skill on server

### Skill tools

- `lore_skill_list` / `lore_skill_search` / `lore_skill_get` / `lore_skill_create` / `lore_skill_update` / `lore_skill_delete` / `lore_skill_status`

## Project Structure

```
hermes-plugin/
├── README.md
└── lore_memory/
    ├── __init__.py         # MemoryProvider + tool schemas/handlers
    ├── client.py           # HTTP client for Lore API (incl. /skills)
    ├── formatters.py       # Output formatting
    ├── skill_workcopy.py   # Python-native writable skill work-copy core
    ├── plugin.yaml         # Plugin manifest
    └── test_thin_adapters.py
```

## License

MIT

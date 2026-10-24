# Lore Hermes Plugin

Long-term memory and Skill work-copy integration for [Hermes Agent](https://github.com/hermes) using the [Lore](https://github.com/FFatTiger/lore) memory system.

## Features

- **Persistent Memory** - Store and retrieve memories across sessions
- **Automatic Recall** - Semantic memory injection before processing queries
- **Session Tracking** - Track which memories have been read
- **Full CRUD Operations** - Create, read, update, delete memory nodes
- **Search & Discovery** - Keyword and semantic search
- **Lore Skills** - Server skills sync into `~/.lore/skills/<project-id>/` at session start and surface through Hermes' native skill system

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
- Registers **memory + skill management tools** for the agent to use
- Syncs **Lore skills** into `~/.lore/skills/<project-id>/` for Hermes' native skill index

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
```

## Skills workflow

Lore is the install target and source of truth for skills; the plugin never copies them into Hermes itself. At each session start (Hermes `on_session_start` hook) a background thread reconciles the server catalog into `${LORE_HOME:-~/.lore}/skills/<project-id>/` and records the outcome in `.lore-sync-status.json` inside that directory.

To make the synced skills visible to Hermes, list the directory under `skills.external_dirs` in `~/.hermes/config.yaml` (Hermes expands `~`):

```yaml
skills:
  external_dirs:
    - ~/.lore/skills/<project-id>
```

External-directory skills behave exactly like local skills: they enter the system-prompt index, `skills_list`, and the `/skill-name` command. Changes sync at the next session start, or immediately after Hermes' `/reload-skills` refreshes the index.

The sync only manages directories carrying a Lore marker; same-named unmanaged directories are never touched. Server-side updates overwrite only server-managed files; local artifacts you add inside a skill directory survive updates and removals. Skills deleted or disabled on the server lose their managed files but keep local artifacts.

- `lore_skill_list` / `lore_skill_search` / `lore_skill_import` manage skills on the server.
- `lore_skill_create` / `lore_skill_update` / `lore_skill_delete` change the server copy; the local directory follows at the next session start (`lore_skill_update` requires a positive integer `expected_version`).
- There is no per-skill load tool and no behavioral prompt guidance for when to use skills.

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
| `LORE_HOME` | `~/.lore` | Root of the synced local skills directory |

## API Reference

### LoreClient

- `health()` - Check server status
- `boot()` - Load boot memories
- `get_node(uri, nav_only, session_id, query_id)` - Read memory node
- `create_node(content, priority, glossary, uri, domain, parent_path, title, disclosure)` - Create new memory
- `update_node(uri, content, priority, disclosure, glossary_add, glossary_remove)` - Update existing memory
- `delete_node(uri)` - Delete memory
- `move_node(old_uri, new_uri)` - Move or rename a memory node
- `search(query, domain, limit, full)` - Search memories (sends `full` and the derived `content_limit` so both backends return at most one full content)
- `recall(query, session_id, limit, max_items)` - Semantic recall
- `list_domains()` - List all domains
- `mark_recall_used(query_id, session_id, uris)` - Mark recall events as adopted
- `list_skills(include_disabled=True)` - List project skills
- `search_skills(query, limit=None)` - Search/recall skills
- `create_skill(body)` - Create skill on server
- `update_skill(skill_id, body)` - Update skill (`expected_version` required, positive integer)
- `delete_skill(skill_id)` - Archive/delete skill on server

### Skill tools

- `lore_skill_list` / `lore_skill_search` / `lore_skill_create` / `lore_skill_update` / `lore_skill_delete` / `lore_skill_import` (public GitHub repo import; supports `dry_run`)

## Project Structure

```
hermes-plugin/
├── README.md
└── lore_memory/
    ├── __init__.py         # MemoryProvider + tool schemas/handlers
    ├── client.py           # HTTP client for Lore API (incl. /skills)
    ├── formatters.py       # Output formatting
    ├── skill_workcopy.py   # Python-native skill work-copy core + session-start sync
    ├── plugin.yaml         # Plugin manifest
    └── test_thin_adapters.py
```

## License

MIT

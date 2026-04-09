# Lore

Self-hosted long-term memory for AI agents. Integrates with [Claude Code](https://claude.ai/code), [OpenClaw](https://github.com/openclaw/openclaw), and any MCP-compatible client.

## Screenshots

| Memory Browser | Recall Workbench |
|:-:|:-:|
| ![Memory Browser](docs/screenshots/memory-browser.jpg) | ![Recall Workbench](docs/screenshots/recall-workbench.jpg) |

| Recall Analytics | Dream Diary |
|:-:|:-:|
| ![Recall Analytics](docs/screenshots/recall-analytics.jpg) | ![Dream Diary](docs/screenshots/dream-diary.jpg) |

| Settings |
|:-:|
| ![Settings](docs/screenshots/settings.jpg) |

## What it does

Lore gives an AI agent **persistent memory that survives session resets**. Instead of stuffing everything into context or forgetting between conversations, the agent stores, retrieves, and maintains structured memories through a clean tool interface.

Core capabilities:

- **Boot** — restore identity, preferences, and rules at session start
- **Recall** — semantic pre-fetch of relevant memories before each reply, with 8 pluggable scoring strategies
- **Read / Search** — explicit memory lookup by URI, keyword, or vector similarity
- **Write** — create, update, delete, and alias memory nodes with policy validation
- **Dream** — LLM-driven autonomous memory consolidation (merge, prune, restructure)
- **Backup** — scheduled local + WebDAV database backup and restore
- **Web UI** — browse, inspect, configure, and manage the full memory graph

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  AI Agent (Claude Code / OpenClaw / MCP Client)     │
│  ┌───────────┐  recall injection   ┌─────────────┐ │
│  │  LLM      │◄───────────────────│  Plugin /    │ │
│  │           │  tool calls ──────►│  MCP Client  │ │
│  └───────────┘                    └──────┬──────┘ │
└──────────────────────────────────────────┼────────┘
                                           │ HTTP / MCP
┌──────────────────────────────────────────┼────────┐
│  Lore (Next.js SSR + TypeScript)     │        │
│  ┌──────────┐  ┌──────────┐  ┌──────────▼──────┐ │
│  │  Web UI  │  │ REST API │  │  MCP Endpoint   │ │
│  │  7 pages │  │  /api/*  │  │  /api/mcp       │ │
│  └──────────┘  └──────────┘  └──────────┬──────┘ │
│                                         │        │
│  ┌──────────────────────────────────────▼──────┐ │
│  │              Server Layer (34 modules)       │ │
│  │  boot · recall · search · write · dream     │ │
│  │  scoring · views · glossary · policy        │ │
│  │  backup · review · maintenance · settings   │ │
│  └──────────────────┬──────────────────────────┘ │
└─────────────────────┼────────────────────────────┘
                      │
          ┌───────────▼───────────┐
          │  PostgreSQL + pgvector │
          │  · structured data     │
          │  · FTS (zhparser)      │
          │  · vector embeddings   │
          └───────────────────────┘
```

Single app. Single database. No extra vector service, no separate backend.

## Key Concepts

### Memory Nodes

Each memory is a **node** with:

| Field | Purpose |
|-------|---------|
| `uri` | Unique address, e.g. `core://soul`, `project://my_project` |
| `content` | The actual memory text |
| `priority` | Importance tier — 0 = core identity, 1 = key facts, 2+ = general |
| `disclosure` | When to recall this memory (trigger description) |
| `glossary` | Keywords for search indexing and semantic retrieval |

### Domains

URIs are namespaced by domain: `core://`, `preferences://`, `project://`, etc. Domains organize memories by category without rigid folder hierarchies.

### Alias

One memory, multiple entry points. A node at `project://my_project` can have an alias at `workflow://memory_backend` — same content, different trigger context and priority.

### Retrieval Layers

| Layer | What it does |
|-------|-------------|
| **Boot** | Loads designated core URIs at session start |
| **Recall** | Multi-signal semantic pre-fetch before each LLM turn |
| **Search** | Hybrid FTS + vector search for explicit queries |

Recall uses a **cue-card strategy** — embeddings are built from URI, title, glossary, and disclosure rather than full content. This keeps recall focused on "should I think about this?" rather than fuzzy content matching.

Candidates from four retrieval paths (exact, glossary-semantic, dense, lexical) are ranked using one of **8 pluggable scoring strategies** (default: `raw_plus_lex_damp`). The resulting score (0~1) drives both ranking order and display threshold.

### Memory Views

Each memory node generates derived **views** (gist + question) that serve as embedding targets for recall. Views can optionally be refined by an LLM to improve retrieval quality. View weights and priors are configurable per view type.

### Dream Consolidation

Lore can run autonomous **dream cycles** — an LLM agent reviews memory health metrics, identifies dead writes, noisy nodes, and structural issues, then creates, updates, merges, or prunes memories. Dreams run on a configurable schedule and produce diary entries that can be reviewed and rolled back.

### Policy System

Write operations are validated by configurable policies:
- **Priority budgets** — limits on how many p0/p1 nodes can exist
- **Read-before-modify** — warns if updating a node you haven't read this session
- **Disclosure validation** — flags OR-logic in disclosure triggers

## Quick Start

### Docker (recommended)

```bash
git clone https://github.com/FFatTiger/lore.git
cd lore
cp .env.example .env
# edit .env — at minimum, change POSTGRES_PASSWORD
docker compose up -d
```

Verify it's running:

```bash
curl http://127.0.0.1:18901/api/health
```

Open `http://127.0.0.1:18901` for the Web UI.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `lore` | Database name |
| `POSTGRES_USER` | `lore` | Database user |
| `POSTGRES_PASSWORD` | `change-me` | **Change this** |
| `POSTGRES_PORT` | `5432` | PostgreSQL exposed port |
| `DATABASE_URL` | auto | Full connection string |
| `API_TOKEN` | (empty) | Set this for auth on public deployments |
| `WEB_PORT` | `18901` | Web app port |
| `CORE_MEMORY_URIS` | `core://soul,preferences://user,core://agent` | URIs loaded on boot |

Recall weights, scoring strategy, view LLM, embedding endpoint, dream schedule, backup config, and policy settings are managed at runtime via the **Settings UI** (`/settings`), stored in the `app_settings` table.

### Local Development

```bash
cd app
cp .env.local.example .env.local
npm install
npm run dev
```

Requires Node.js 20+ and a local PostgreSQL instance with the `vector` extension.

## MCP Server

Lore embeds an MCP server directly in the web application. Any MCP-compatible client can connect via **Streamable HTTP** at:

```
http://<your-host>:18901/api/mcp
```

No separate process — the MCP endpoint shares the same database pool and server logic as the REST API.

## Claude Code Integration

Lore ships as a **Claude Code plugin** that bundles MCP tools, recall injection, and agent guidance rules.

```bash
# 1. Add the environment variable to your shell profile
echo 'export LORE_BASE_URL="http://your-server:18901"' >> ~/.zshrc
source ~/.zshrc

# 2. Register the marketplace (one-time, uses the plugin branch)
claude plugins marketplace add FFatTiger/lore --ref plugin

# 3. Install the plugin
claude plugins install lore@lore
```

The plugin auto-registers:
- **MCP server** — connects to `$LORE_BASE_URL/api/mcp`
- **SessionStart hook** — loads identity memories and agent guidance rules at session start
- **UserPromptSubmit hook** — injects `<recall>` context before each prompt

To update: `claude plugins update lore@lore`
To uninstall: `claude plugins uninstall lore@lore`

## OpenClaw Plugin

Copy or symlink `openclaw-plugin/` into your OpenClaw plugin path, then configure in `openclaw.json`:

```jsonc
{
  "plugins": {
    "load": { "paths": ["/path/to/openclaw-plugin"] },
    "entries": {
      "lore": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:18901",
          "recallEnabled": true,
          "startupHealthcheck": true,
          "embeddingBaseUrl": "http://127.0.0.1:8090/v1",
          "embeddingApiKey": "your-key",
          "embeddingModel": "text-embedding-3-large"
        }
      }
    }
  }
}
```

### Plugin Config Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `baseUrl` | string | — | **Required.** Lore web app URL |
| `apiToken` | string | — | API token if auth is enabled |
| `timeoutMs` | integer | `30000` | Request timeout |
| `recallEnabled` | boolean | `true` | Inject recall candidates into prompts |
| `startupHealthcheck` | boolean | `true` | Health check on gateway start |
| `embeddingBaseUrl` | string | — | OpenAI-compatible embedding endpoint |
| `embeddingApiKey` | string | — | Embedding API key |
| `embeddingModel` | string | — | Embedding model name |
| `minDisplayScore` | number | `0.4` | Minimum recall score to display |
| `maxDisplayItems` | integer | `3` | Max recall candidates per turn |
| `injectPromptGuidance` | boolean | `true` | Add usage hints to system prompt |
| `readNodeDisplayMode` | string | `soft` | `soft` = condensed, `hard` = full dump |
| `excludeBootFromResults` | boolean | `false` | Exclude boot nodes from recall results |

## Agent Tools

The plugin exposes 11 tools to the LLM:

| Tool | Purpose |
|------|---------|
| `lore_status` | Check connection health |
| `lore_boot` | Load core memories for session init |
| `lore_get_node` | Read a node by URI |
| `lore_search` | Find memories by keyword or domain |
| `lore_list_domains` | Browse top-level domains |
| `lore_create_node` | Create a new memory |
| `lore_update_node` | Revise existing memory content |
| `lore_delete_node` | Remove a memory path |
| `lore_move_node` | Move or rename a memory node |
| `lore_list_session_reads` | Show memories read this session |
| `lore_clear_session_reads` | Reset session read tracking |

All read/write tools use `uri` as the primary node identifier.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Service health check |
| `/api/mcp` | POST/GET/DELETE | MCP Streamable HTTP endpoint |
| `/api/browse/boot` | GET | Load boot memories |
| `/api/browse/domains` | GET | List all domains |
| `/api/browse/node` | GET/PUT/POST/DELETE | Node CRUD |
| `/api/browse/search` | GET/POST | Hybrid FTS + vector search |
| `/api/browse/alias` | POST | Create alias |
| `/api/browse/glossary` | GET/POST/DELETE | Glossary keyword management |
| `/api/browse/triggers` | POST | Disclosure triggers |
| `/api/browse/session/read` | GET/POST/DELETE | Session read tracking |
| `/api/browse/recall` | POST | Get recall candidates |
| `/api/browse/recall/debug` | POST | Recall debug with full signal breakdown |
| `/api/browse/recall/stats` | GET | Recall event statistics |
| `/api/browse/recall/usage` | POST | Mark recall events used in answer |
| `/api/browse/recall/rebuild` | POST | Rebuild recall index |
| `/api/browse/dream` | GET/POST | Dream diary and manual trigger |
| `/api/browse/events` | GET | Memory write event log |
| `/api/browse/events/timeline` | GET | Event timeline view |
| `/api/browse/feedback` | GET | Memory health analytics |
| `/api/settings` | GET/PUT | Runtime settings |
| `/api/settings/reset` | POST | Reset settings to defaults |
| `/api/backup` | GET/POST | Database backup and restore |
| `/api/review/*` | — | Memory review and changeset management |
| `/api/maintenance/*` | — | Orphan detection and cleanup |

## Settings

Runtime configuration is managed through the Settings UI at `/settings`, organized into 11 sections:

| Section | What it controls |
|---------|-----------------|
| **Scoring Strategy** | Algorithm selection (8 strategies) |
| **Scoring Weights** | Four-path weight balance (exact, glossary, dense, lexical) |
| **Scoring Bonus** | Priority and multi-view bonuses |
| **Recency Decay** | Time decay half-life and max bonus |
| **Display** | Score threshold, max items, read-node strategy |
| **View Weights** | Gist/question view weights and priors |
| **Embedding** | Embedding service endpoint and model |
| **View LLM** | LLM for view refinement (model, temperature, limits) |
| **Policy** | Write validation rules (budgets, read-before-modify) |
| **Dream** | Dream schedule (enabled, hour, timezone) |
| **Backup** | Backup schedule, retention, local/WebDAV targets |

## Project Structure

```
.
├── app/                            # Next.js SSR app (TypeScript)
│   ├── app/                        #   App Router pages & API routes
│   │   ├── api/
│   │   │   ├── browse/             #     Memory CRUD, search, recall, dream
│   │   │   ├── review/             #     Review endpoints
│   │   │   ├── maintenance/        #     Orphan management
│   │   │   ├── settings/           #     Runtime settings
│   │   │   ├── backup/             #     Backup & restore
│   │   │   └── health/             #     Health check
│   │   ├── memory/                 #     Memory browser UI
│   │   ├── recall/                 #     Recall workbench + drilldown UI
│   │   ├── dream/                  #     Dream diary UI
│   │   ├── settings/               #     Settings UI
│   │   └── maintenance/            #     Maintenance UI
│   ├── pages/api/
│   │   └── mcp.ts                  #   MCP Streamable HTTP endpoint
│   ├── server/
│   │   ├── db.ts                   #     Database connection pool
│   │   ├── auth.ts                 #     Bearer token auth
│   │   ├── middleware.ts           #     Shared route middleware
│   │   ├── mcpFormatters.ts        #     MCP response formatting
│   │   ├── mcpServer.ts            #     Embedded MCP server (11 tools)
│   │   └── lore/               #     Core business logic (34 modules)
│   │       ├── types.ts            #       Shared type definitions
│   │       ├── constants.ts        #       Constants
│   │       ├── recall.ts           #       Recall pipeline orchestration
│   │       ├── recallScoring.ts    #       Candidate collection & routing
│   │       ├── scoringStrategies.ts#       8 pluggable scoring algorithms
│   │       ├── recallEventLog.ts   #       Recall event logging
│   │       ├── recallAnalytics.ts  #       Recall statistics & analytics
│   │       ├── viewBuilders.ts     #       FTS config, view construction
│   │       ├── viewLlm.ts          #       LLM view refinement pipeline
│   │       ├── viewCrud.ts         #       View table CRUD & indexing
│   │       ├── memoryViewQueries.ts#       Dense/lexical/exact queries
│   │       ├── write.ts            #       Memory CRUD operations
│   │       ├── writeEvents.ts      #       Write event audit log
│   │       ├── browse.ts           #       Node navigation & hierarchy
│   │       ├── search.ts           #       Hybrid FTS + vector search
│   │       ├── boot.ts             #       Session bootstrap
│   │       ├── glossary.ts         #       Glossary keyword management
│   │       ├── glossarySemantic.ts #       Glossary embeddings
│   │       ├── policy.ts           #       Write validation policies
│   │       ├── settings.ts         #       Runtime settings engine
│   │       ├── settingsSchema.ts   #       Settings schema (47 entries)
│   │       ├── dreamAgent.ts       #       LLM dream agent & tools
│   │       ├── dreamDiary.ts       #       Dream orchestration & diary
│   │       ├── backup.ts           #       Database backup/restore
│   │       ├── review.ts           #       Changeset review system
│   │       ├── feedbackAnalytics.ts#       Memory health reporting
│   │       ├── maintenance.ts      #       Orphan detection & cleanup
│   │       ├── session.ts          #       Session read tracking
│   │       ├── retrieval.ts        #       Document normalization CTE
│   │       ├── embeddings.ts       #       Embedding API client
│   │       ├── utils.ts            #       Shared utilities
│   │       ├── tableInit.ts        #       Lazy table initialization
│   │       ├── dreamScheduler.ts   #       Dream cron scheduler
│   │       └── backupScheduler.ts  #       Backup cron scheduler
│   ├── components/                 #   Shared UI components (TSX)
│   ├── lib/                        #   Frontend utilities
│   └── Dockerfile
├── openclaw-plugin/                # OpenClaw integration plugin
│   ├── index.ts                    #   Plugin entry point
│   ├── tools.ts                    #   11 tool registrations
│   ├── hooks.ts                    #   Gateway, hooks, session tracking
│   ├── api.ts                      #   HTTP client
│   ├── formatters.ts               #   Response formatting
│   └── uri.ts                      #   URI utilities
├── claudecode-plugin/              # Claude Code plugin (published to `plugin` branch by CI)
│   ├── .claude-plugin/
│   │   ├── plugin.json             #   Plugin manifest
│   │   └── marketplace.json        #   Marketplace registry
│   ├── .mcp.json                   #   MCP server config
│   ├── hooks/
│   │   ├── hooks.json              #   Hook definitions
│   │   ├── recall-inject.ts        #   Recall injection on each prompt
│   │   └── rules-inject.ts        #   Boot + guidance on session start
│   └── rules/
│       └── lore-guidance.md        #   Agent guidance rules
├── postgres/                       # Custom PostgreSQL image
│   └── Dockerfile                  #   pgvector:pg16 + zhparser
├── docker-compose.yml
├── docker-compose.portainer.yml
├── .env.example
└── README.md
```

## Design Decisions

**Monolith over microservices.** UI, API, and data access live in one Next.js app. Fewer moving parts, fewer failure modes, easier to debug.

**TypeScript throughout.** The entire codebase (server, frontend, plugins, tests) is TypeScript with strict mode. Shared type definitions ensure consistency across 34 server modules.

**PostgreSQL for everything.** Structured data, full-text search (with Chinese segmentation via zhparser), and vector search all in one database. No separate vector service.

**Embedded MCP.** The MCP server runs inside the web app, sharing the same database pool and server functions. No separate process — tools invoke internal functions directly.

**Narrow tool surface.** 11 tools for the agent. Maintenance, review, analytics, and dream capabilities exist in the API and UI but aren't exposed to the LLM by default.

**Cue-card embeddings.** Recall embeddings are built from URI, title, glossary, and disclosure — not the full content body. This makes recall a "should I think about this?" signal rather than a fuzzy content match.

**8 scoring strategies.** Recall ranking is pluggable: `raw_plus_lex_damp` (default), `normalized_linear`, `rrf`, `weighted_rrf`, `max_signal`, `cascade`, `dense_floor`, `raw_score`. Each strategy combines scores from four retrieval paths (exact, glossary-semantic, dense, lexical) differently.

**Dream consolidation.** An LLM agent periodically reviews memory health metrics, identifies issues (dead writes, noisy nodes, structural problems), and autonomously restructures the memory graph. All changes are logged and reversible.

**Policy-gated writes.** Create/update/delete operations are validated against configurable policies (priority budgets, read-before-modify checks, disclosure validation) to prevent accidental memory corruption.

## Credits

Based on [nocturne_memory](https://github.com/Dataojitori/nocturne_memory) by Dataojitori.

## License

MIT

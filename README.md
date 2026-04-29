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

- **Boot** — load Lore's fixed startup baseline: 3 global boot nodes plus an optional client-specific agent boot node such as `core://agent/openclaw`
- **Recall** — semantic pre-fetch of relevant memories before each reply, with 8 pluggable scoring strategies
- **Read / Search** — explicit memory lookup by URI, keyword, or vector similarity
- **Write** — create, update, delete, and alias memory nodes with policy validation
- **Dream** — structure-first memory audit for path placement, split/move judgment, and cautious repairs with rollback
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
│  │  6 pages │  │  /api/*  │  │  /api/mcp       │ │
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
| **Boot** | Loads Lore's fixed startup baseline: 3 global boot nodes plus an optional client-specific agent boot node |
| **Recall** | Multi-signal semantic pre-fetch before each LLM turn |
| **Search** | Hybrid FTS + vector search for explicit queries |

Recall uses a **cue-card strategy** — embeddings are built from URI, title, glossary, and disclosure rather than full content. This keeps recall focused on "should I think about this?" rather than fuzzy content matching.

Candidates from four retrieval paths (exact, glossary-semantic, dense, lexical) are ranked using one of **8 pluggable scoring strategies** (default: `raw_plus_lex_damp`). The resulting score (0~1) drives both ranking order and display threshold.

### Memory Views

Each memory node generates derived **views** (gist + question) that serve as embedding targets for recall. Views can optionally be refined by an LLM to improve retrieval quality. View weights and priors are configurable per view type.

### Dream Structural Audit

Lore can run autonomous **dream cycles** — an LLM agent reviews memory health metrics, checks path placement and split needs, distinguishes retrieval-path issues from node-structure issues, and makes cautious move/update/delete decisions. Fixed boot nodes stay protected, and every change is logged and can be rolled back.

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

Boot is fixed in server code. Lore always loads the same three global startup nodes: `core://agent`, `core://soul`, and `preferences://user`. When the current runtime has a matching `client_type`, Lore also loads a client-specific agent boot node such as `core://agent/openclaw`.

Recall weights, scoring strategy, view LLM, embedding endpoint, dream schedule, backup config, and policy settings are managed at runtime via the **Settings UI** (`/settings`), stored in the `app_settings` table.

For LLM/embedding transport, Lore now supports:
- `LORE_VIEW_LLM_PROVIDER=openai_compatible` → Vercel AI SDK + OpenAI-compatible `/chat/completions`
- `LORE_VIEW_LLM_PROVIDER=openai_responses` → Vercel AI SDK + OpenAI `/responses`
- `LORE_VIEW_LLM_PROVIDER=anthropic` → Vercel AI SDK + Anthropic `/messages`
- `LORE_EMBEDDING_PROVIDER=openai_compatible` → `/embeddings`

Dream tool calling and View refinement now run through the Vercel AI SDK. Embedding calls stay on the existing OpenAI-compatible `/embeddings` transport for now.

Optional provider-specific env:
- `LORE_VIEW_LLM_TIMEOUT_MS`
- `LORE_VIEW_LLM_API_VERSION` (mainly for Anthropic)

If you leave provider unset, Lore keeps the old behavior and defaults to `openai_compatible`.

### Local Development

```bash
cd web
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

## Codex Integration

Lore ships a Codex plugin source tree under `codex-plugin/`. CI publishes it to the `plugin` branch using the official Codex marketplace layout:

- `.agents/plugins/marketplace.json`
- `plugins/lore/.codex-plugin/plugin.json`
- `plugins/lore/.mcp.json`
- `plugins/lore/skills/`

```bash
export LORE_BASE_URL=http://127.0.0.1:18901
cd codex-plugin
./scripts/install.sh
```

The installer stages the Codex marketplace layout locally, registers the marketplace, enables `lore@lore`, configures MCP, and installs the optional Codex hooks. Restart Codex after it finishes.

Codex hooks are optional and explicit. The official Codex hook locations are `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, and `<repo>/.codex/config.toml`; Lore does not assume plugin installation auto-loads hooks.

```bash
./scripts/install-hooks.sh
```

When `API_TOKEN` is enabled on the Lore server, configure Codex's Streamable HTTP MCP bearer token support:

```bash
export LORE_API_TOKEN="$API_TOKEN"
./scripts/install.sh
```

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

## Hermes Plugin

Copy or symlink `hermes-plugin/lore_memory/` into your Hermes skills directory, then enable it in Hermes config:

```bash
# Symlink into Hermes skills
cd ~/.hermes/skills/
ln -s /path/to/lore/hermes-plugin/lore_memory lore
```

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LORE_BASE_URL` | `http://127.0.0.1:18901` | Lore server URL |
| `LORE_API_TOKEN` | — | API token if auth is enabled |
| `LORE_TIMEOUT` | `30` | Request timeout in seconds |
| `LORE_DEFAULT_DOMAIN` | `core` | Default memory domain |

## Agent Tools

The plugin exposes 12 tools to the LLM:

| Tool | Purpose |
|------|---------|
| `lore_guidance` | Load the full Lore usage rules |
| `lore_status` | Check connection health |
| `lore_boot` | Load the fixed startup baseline (3 global boot nodes + optional client-specific agent boot node) |
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
├── web/                            # Next.js SSR app (TypeScript)
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
│   │   ├── mcpServer.ts            #     Embedded MCP server (12 tools)
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
├── codex-plugin/                   # Codex plugin source, published to `plugins/lore` on `plugin` branch
│   ├── .agents/plugins/
│   │   └── marketplace.json        #   Codex marketplace catalog
│   ├── .codex-plugin/
│   │   └── plugin.json             #   Codex plugin manifest
│   ├── .mcp.json                   #   MCP server config using client_type=codex
│   ├── skills/
│   │   └── lore-memory/            #   Codex skill
│   ├── hooks/                      #   Optional Codex hook helpers
│   ├── rules/
│   │   └── lore-guidance.md        #   Codex-specific guidance rules
│   └── scripts/
│       └── install-hooks.sh        #   Explicit Codex hooks installer
├── hermes-plugin/                  # Hermes Agent integration plugin
│   └── lore_memory/                #   MemoryProvider implementation
│       ├── __init__.py             #   Plugin entry + tool schemas
│       ├── client.py               #   HTTP client
│       ├── formatters.py           #   Response formatting
│       ├── AGENT_RULES.md          #   Agent guidance rules
│       └── plugin.yaml             #   Plugin manifest
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

**Narrow tool surface.** 12 tools for the agent. Maintenance, review, analytics, and dream capabilities exist in the API and UI but aren't exposed to the LLM by default.

**Cue-card embeddings.** Recall embeddings are built from URI, title, glossary, and disclosure — not the full content body. This makes recall a "should I think about this?" signal rather than a fuzzy content match.

**8 scoring strategies.** Recall ranking is pluggable: `raw_plus_lex_damp` (default), `normalized_linear`, `rrf`, `weighted_rrf`, `max_signal`, `cascade`, `dense_floor`, `raw_score`. Each strategy combines scores from four retrieval paths (exact, glossary-semantic, dense, lexical) differently.

**Dream structural audit.** An LLM agent periodically reviews memory health metrics, checks path placement and split needs, distinguishes retrieval-path issues from node-structure issues, and makes cautious changes with full rollback support.

**Policy-gated writes.** Create/update/delete operations are validated against configurable policies (priority budgets, read-before-modify checks, disclosure validation) to prevent accidental memory corruption.

## Credits

Based on [nocturne_memory](https://github.com/Dataojitori/nocturne_memory) by Dataojitori.

## License

MIT

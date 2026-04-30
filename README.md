# Lore

[中文 README](./README.zh-CN.md)

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

## Design philosophy

Lore is a long-term memory system for AI agents. It gives an agent a durable memory graph, a fixed startup baseline, per-prompt recall, explicit read tracking, and cautious write tools.

Most agent memory systems stop at retrieval. Lore focuses on the full memory lifecycle:

- **Boot baseline** — every session starts with stable identity, workflow, user, and runtime memories.
- **Recall before reply** — the agent receives a small `<recall>` block with relevant candidates before answering.
- **Read before trust** — recalled candidates are cues; the agent opens the memory node before relying on it.
- **URI-first graph** — memories live at durable URIs such as `core://agent`, `preferences://user`, and `project://my_project`.
- **Disclosure triggers** — each memory carries a natural-language condition that explains when it should surface.
- **Policy-guided writes** — priority budgets, read-before-modify checks, and boot-node protection keep the graph stable.
- **Dream maintenance** — scheduled review can inspect recall quality, structure, and stale nodes with rollback history.

Lore is built for agents that need continuity across sessions, tools, and runtimes.

## Quick start

### 1. Start the server

Create a `docker-compose.yml` with the production images:

```yaml
services:
  postgres:
    image: fffattiger/pgvector-zhparser:pg16
    platform: linux/amd64
    restart: unless-stopped
    environment:
      POSTGRES_DB: lore
      POSTGRES_USER: lore
      POSTGRES_PASSWORD: replace-this
    ports:
      - "5432:5432"
    volumes:
      - lore_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lore -d lore"]
      interval: 10s
      timeout: 5s
      retries: 10

  web:
    image: fffattiger/lore:latest
    platform: linux/amd64
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://lore:replace-this@postgres:5432/lore
      API_TOKEN: replace-this-if-exposed
      SNAPSHOT_DIR: /app/snapshots
    ports:
      - "18901:18901"
    volumes:
      - lore_snapshots:/app/snapshots

volumes:
  lore_postgres_data:
  lore_snapshots:
```

Start Lore:

```bash
docker compose up -d
```

Check health:

```bash
curl http://127.0.0.1:18901/api/health
```

Open the UI:

```text
http://127.0.0.1:18901
```

### 2. Complete first-run setup

After the server is running, open:

```text
http://127.0.0.1:18901/setup
```

Complete the setup flow:

1. **Embedding setup** — configure an OpenAI-compatible embedding endpoint.
   - `Embedding Base URL`, for example `http://host.docker.internal:8090/v1`
   - `Embedding API Key`
   - `Embedding Model`, for example `Qwen/Qwen3-Embedding-0.6B`
2. **Global boot memories** — review or save defaults for:
   - `core://agent`
   - `core://soul`
   - `preferences://user`
3. **Channel agent memories** — review or save defaults for runtime-specific memories:
   - `core://agent/claudecode`
   - `core://agent/codex`
   - `core://agent/openclaw`
   - `core://agent/hermes`
   - `core://agent/pi`

The `Skip` button saves the default value for an empty boot node and moves forward.

### 3. Configure optional runtime settings

Open `/settings` after setup for:

- recall scoring strategy and thresholds
- View LLM for view refinement and Dream
- Dream schedule
- backup settings
- write policy settings

View LLM is optional for basic memory and recall. Embedding is required for semantic recall and index rebuilds.

### Source build fallback

For local development or custom builds:

```bash
git clone https://github.com/FFatTiger/lore.git
cd lore
cp .env.example .env
# edit .env first
docker compose up -d --build
```

## Connect agents

Set the Lore server URL for plugins:

```bash
export LORE_BASE_URL=http://127.0.0.1:18901
export LORE_API_TOKEN=replace-this-if-you-set-API_TOKEN
```

### Claude Code

Lore ships as a Claude Code plugin on the `plugin` branch.

```bash
export LORE_BASE_URL=http://127.0.0.1:18901
claude plugins marketplace add FFatTiger/lore --ref plugin
claude plugins install lore@lore
```

Restart Claude Code after installing.

What it adds:

- MCP tools at `${LORE_BASE_URL}/api/mcp?client_type=claudecode`
- session-start boot injection
- per-prompt recall injection
- Lore guidance rules

### Codex

```bash
export LORE_BASE_URL=http://127.0.0.1:18901
cd codex-plugin
./scripts/install.sh
```

If the server uses `API_TOKEN`:

```bash
export LORE_API_TOKEN=replace-this
./scripts/install.sh
```

Restart Codex after installing.

What it adds:

- local Codex marketplace entry `lore@lore`
- MCP server at `${LORE_BASE_URL}/api/mcp?client_type=codex`
- optional hooks for boot and recall injection

### Pi

```bash
export LORE_BASE_URL=http://127.0.0.1:18901
./pi-extension/scripts/install-local.sh
```

Then run `/reload` in Pi or restart Pi.

What it adds:

- Lore tools registered with `pi.registerTool`
- boot and recall context through Pi startup hooks
- API attribution with `client_type=pi`

### OpenClaw

Copy or symlink `openclaw-plugin/` into your OpenClaw plugin path, then configure OpenClaw with the Lore base URL.

Example config shape:

```jsonc
{
  "plugins": {
    "load": { "paths": ["/path/to/openclaw-plugin"] },
    "entries": {
      "lore": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:18901",
          "apiToken": "replace-this-if-needed",
          "recallEnabled": true,
          "startupHealthcheck": true
        }
      }
    }
  }
}
```

Restart OpenClaw after changing plugin config.

### Hermes

Install the Hermes memory provider plugin and set environment variables:

```bash
export LORE_BASE_URL=http://127.0.0.1:18901
export LORE_API_TOKEN=replace-this-if-needed
```

Symlink or copy `hermes-plugin/lore_memory` into the Hermes plugin path configured on your machine. Hermes loads Lore as a MemoryProvider and exposes Lore memory tools to the agent.

### Generic MCP client

Lore exposes a Streamable HTTP MCP endpoint:

```text
http://127.0.0.1:18901/api/mcp
```

Use a client-specific query parameter when possible:

```text
http://127.0.0.1:18901/api/mcp?client_type=mcp
```

If `API_TOKEN` is configured, pass it as a bearer token.

## Daily use

Once connected, the agent workflow is:

1. load boot memories at session start
2. receive `<recall>` candidates before user prompts
3. open relevant nodes with `lore_get_node`
4. create or update durable memories when something should survive the session
5. use the Web UI to inspect recall quality, memory history, settings, backup, and Dream maintenance

Useful UI pages:

- `/memory` — browse and edit the memory graph
- `/recall` — inspect retrieval stages and scoring
- `/dream` — run structural maintenance
- `/settings` — configure runtime behavior

## Development

```bash
cd web
cp .env.local.example .env.local
npm install
npm run dev
```

Requires Node.js 20+ and PostgreSQL with the `vector` extension.

<p align="center">
  <img src="docs/assets/lore-logo.svg" alt="Lore logo" width="96">
</p>

# Lore

<p align="center">
  <strong>One long-term memory system across your AI agents.</strong>
</p>

<p align="center">
  Boot a stable baseline every session, recall the right nodes before each reply,<br>
  and keep a durable memory graph that survives tools, restarts, and runtimes.
</p>

<p align="center">
  <a href="https://loremem.com"><img src="https://img.shields.io/badge/website-loremem.com-0f766e?style=flat-square" alt="Website"></a>
  <a href="https://github.com/FFatTiger/lore/releases/latest"><img src="https://img.shields.io/github/v/release/FFatTiger/lore?style=flat-square&label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/FFatTiger/lore?style=flat-square" alt="MIT license"></a>
  <a href="https://hub.docker.com/r/fffattiger/lore"><img src="https://img.shields.io/badge/docker-fffattiger%2Flore-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker image"></a>
</p>

<p align="center">
  <a href="https://loremem.com"><strong>Website</strong></a> ·
  <a href="https://app.loremem.com"><strong>SaaS</strong></a> ·
  <a href="./README.zh-CN.md">中文</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#supported-runtimes">Runtimes</a> ·
  <a href="#manual-setup">Manual Setup</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="docs/screenshots/recall-analytics.jpg" alt="Lore recall analytics dashboard" width="820">
</p>

| Recall Workbench | Memory Browser | Dream Diary |
|:-:|:-:|:-:|
| ![Recall Workbench](docs/screenshots/recall-workbench.jpg) | ![Memory Browser](docs/screenshots/memory-browser.jpg) | ![Dream Diary](docs/screenshots/dream-diary.jpg) |

## What Lore is

Lore is a self-hosted memory service for coding agents and other LLM runtimes. It gives agents a durable graph of memories, a fixed startup baseline, per-prompt recall, and guarded write tools.

Most memory layers stop at retrieval. Lore covers the full lifecycle:

- **Boot** — load stable identity, workflow, user, and runtime memories at session start
- **Recall** — inject a small `<recall>` candidate set before the agent answers
- **Read before trust** — open a node before relying on a recalled candidate
- **URI-first graph** — durable addresses such as `core://agent`, `preferences://user`, `project://my_project`
- **Disclosure** — each memory states when it should surface
- **Dream** — scheduled maintenance with quality checks and rollback history

## Quick Start

Prefer managed hosting? Use [Loremem SaaS](https://app.loremem.com) and connect agents with a token — no local Docker required. Self-host below if you want everything on your machine.

### 1. Install

Requires Node.js 20+.

```bash
npx @loremem/cli
```

Chinese installer output:

```bash
npx @loremem/cli --lang zh
```

One command:

- starts Lore with Docker Compose (`postgres` + `redis` + `web`) when needed
- connects supported agent runtimes
- writes `~/.lore/config.json`

Bare `npx @loremem/cli` opens the interactive installer on a TTY. Pass flags for non-interactive installs. Re-run anytime to update. Missing agent CLIs are skipped without failing the rest.

Common flags:

| Flag | Description |
| --- | --- |
| `--pre` | Pre-release channel (`pre-latest` image) |
| `--dev` | Dev channel (`dev-latest` image) |
| `--channels CH,...` | Install only some runtimes: `claudecode`, `codex`, `pi`, `openclaw`, `hermes`, `opencode` |
| `--base-url URL` | Use an existing Lore server and skip local Docker |
| `--api-token TOKEN` | API token for the server |
| `--skip-docker` | Configure agents only |
| `--force` | Reinstall even when the version is unchanged |
| `--lang en\|zh` | Installer language |

Examples:

```bash
# Pre-release
npx @loremem/cli install --pre

# External server
npx @loremem/cli install \
  --base-url http://192.168.1.100:18901 --api-token my-token

# Claude Code + Pi only
npx @loremem/cli install --channels claudecode,pi

# Update later
npx @loremem/cli update
npx @loremem/cli status
```

### 2. Finish first-run setup

Open:

```text
http://127.0.0.1:18901/setup
```

Complete:

1. **Embedding** — OpenAI-compatible endpoint used for semantic recall
2. **View LLM** — model used for view refinement and Dream
3. **Global boot memories** — `core://agent`, `core://soul`, `preferences://user`
4. **Channel agent memories** — runtime-specific nodes under `core://agent/*`

`Skip` saves the default value for an empty boot node and continues.

### 3. Success signal

You are ready when:

1. `http://127.0.0.1:18901/setup` completes
2. the Web UI opens at `http://127.0.0.1:18901`
3. restarting a connected agent injects Lore boot context and later shows `<recall>` candidates

Then open `/settings` only if you want to tune recall weights, Dream schedule, backups, or write policy.

## Supported runtimes

| Runtime | Integration | What you get |
| --- | --- | --- |
| **Pi** | `pi-extension/` | Extension tools, startup boot, per-prompt recall. Best fit when you want Lore as the primary memory layer. |
| **Claude Code** | `claudecode-plugin/` | Marketplace plugin, MCP tools, SessionStart boot, per-prompt recall hooks |
| **Codex** | `codex-plugin/` | Local marketplace plugin, MCP config, boot/recall hooks |
| **OpenClaw** | `openclaw-plugin/` | Runtime plugin with boot, recall, and Lore tools |
| **Hermes** | `hermes-plugin/` | MemoryProvider plugin with Lore tools and recall |
| **OpenCode** | `opencode-plugin/` | Native plugin at `~/.config/opencode/plugins/lore-memory.js` with exact `lore_*` tools |
| **Generic MCP** | `/api/mcp` | Streamable HTTP endpoint for clients that can attach remote tools |

After install, restart each runtime. Useful notes:

- **Claude Code** keeps its own auto-memory. To make Lore the only memory system, set `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` or `"autoMemoryEnabled": false` in `~/.claude/settings.json`.
- **Codex** may ask you to trust Lore hooks under `/hooks`. If `/plugins` still shows Lore as installable, install it there; the script has already configured MCP and user-level hooks.
- **OpenCode** reads `~/.lore/config.json`. The installer skips OpenCode cleanly when the `opencode` CLI is absent. See [OpenCode notes](#opencode-notes) for compatibility details.

Generic MCP URL shape:

```text
http://your-host:18901/api/mcp?client_type=mcp
```

## Daily use

Once connected, the agent flow is:

1. load boot memories at session start
2. receive `<recall>` candidates before prompts
3. open relevant nodes with `lore_get_node`
4. create or update durable memories when something should survive the session
5. use the Web UI for graph editing, recall inspection, Dream, backup, and settings

Useful pages:

| Path | Purpose |
| --- | --- |
| `/memory` | Browse and edit the memory graph |
| `/recall` | Inspect retrieval stages and scoring |
| `/dream` | Run structural maintenance |
| `/settings` | Configure runtime behavior |

## Manual setup

Use this path when you want to run the server yourself.

### Docker Compose

```yaml
services:
  postgres:
    image: fffattiger/pgvector-zhparser:pg16
    restart: unless-stopped
    environment:
      TZ: ${TZ:-Asia/Shanghai}
      POSTGRES_DB: ${POSTGRES_DB:-lore}
      POSTGRES_USER: ${POSTGRES_USER:-lore}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-change-me}
    ports:
      - "${POSTGRES_PORT:-55439}:5432"
    volumes:
      - ${POSTGRES_DATA_DIR:-./data/postgres}:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-lore} -d ${POSTGRES_DB:-lore}"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - ${REDIS_DATA_DIR:-./data/redis}:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

  web:
    image: fffattiger/lore:latest
    restart: unless-stopped
    pull_policy: always
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      TZ: ${TZ:-Asia/Shanghai}
      DATABASE_URL: postgresql://${POSTGRES_USER:-lore}:${POSTGRES_PASSWORD:-change-me}@postgres:5432/${POSTGRES_DB:-lore}
      REDIS_URL: redis://redis:6379/0
      API_TOKEN: ${API_TOKEN:-}
    ports:
      - "${WEB_PORT:-18901}:18901"
    volumes:
      - ${SNAPSHOT_DATA_DIR:-./data/snapshots}:/app/snapshots
```

```bash
docker compose up -d
curl http://127.0.0.1:18901/api/health
```

Then point agents at the server:

```bash
npx @loremem/cli install \
  --base-url http://127.0.0.1:18901 --skip-docker
```

### Source build

```bash
git clone https://github.com/FFatTiger/lore.git
cd lore
docker compose up -d --build
```

## Development

App code and `package.json` live under `web/`.

```bash
cd web
cp .env.local.example .env.local
npm install
npm run dev
```

Requirements:

- Node.js 20+
- PostgreSQL with the `vector` extension
- optional Redis; if Redis is unset or unreachable, Lore falls back to a local LRU cache

Useful commands from `web/`:

```bash
npm run typecheck
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for package layout and contribution flow.

## Uninstall

```bash
npx @loremem/cli uninstall
```

```bash
# Specific runtimes
npx @loremem/cli uninstall --channels claudecode,pi

# Remove config and Docker data too
npx @loremem/cli uninstall --purge -y
```

<details>
<summary>Legacy shell installers</summary>

`scripts/install.sh`, `scripts/install.zh.sh`, and `scripts/uninstall.sh` remain for compatibility but are **frozen** and no longer receive new features. Prefer `npx @loremem/cli`.

```bash
# legacy only
curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.sh | bash
```

</details>

## OpenCode notes

<details>
<summary>Native plugin path, compatibility overrides, and MCP escape hatch</summary>

The installer places `lore-memory.js` at `~/.config/opencode/plugins/lore-memory.js` and reads the server URL/token from `~/.lore/config.json`.

Boot is injected through `experimental.chat.system.transform`. Prompt recall is injected as a current-turn part through `chat.message`. If the experimental system hook or Lore is unavailable, the adapter fails open instead of blocking the conversation.

The standard install does not configure OpenCode MCP. The native plugin removes duplicate Lore MCP entries at runtime. When an existing user-level `oh-my-openagent.json[c]` or legacy `oh-my-opencode.json[c]` is safely parseable, the installer also sets `claude_code.plugins_override["lore@lore"] = false` to stop duplicate Claude Lore lifecycle hooks. It does not modify Claude Code files, warns and skips unsafe compatibility config, and restores the previous value on uninstall.

Generic `/api/mcp` remains a manual fallback. Set `LORE_OPENCODE_ALLOW_MCP=1` only when you intentionally want that path.

</details>

## License

[MIT](./LICENSE)

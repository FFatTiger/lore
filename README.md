<p align="center">
  <img src="docs/assets/lore-logo.svg" alt="Lore logo" width="96">
</p>

<h1 align="center">Lore — one memory system across all your agents</h1>

[中文 README](./README.zh-CN.md) · [Quick Start](#3-quick-start) · [Manual Setup](#4-manual-setup) · [Connect Agents](#5-connect-agents) · [CLI Options](#cli-options) · [Daily Use](#6-daily-use) · [Development](#7-development)

## 1. Screenshots

<p align="center">
  <img src="docs/screenshots/recall-analytics.jpg" alt="Recall Analytics">
</p>

| Recall Workbench | Memory Browser | Dream Diary |
|:-:|:-:|:-:|
| ![Recall Workbench](docs/screenshots/recall-workbench.jpg) | ![Memory Browser](docs/screenshots/memory-browser.jpg) | ![Dream Diary](docs/screenshots/dream-diary.jpg) |

---

## 2. Design philosophy

Lore is a long-term memory system for AI agents. It gives an agent a durable memory graph, a fixed startup baseline, per-prompt recall, adoption tracking, and cautious write tools.

Supported runtimes:

| Runtime | Integration | Notes |
|---|---|---|
| **Pi** | `pi-extension/` | Best fit. Pi leaves long-term memory to extensions and keeps its system prompt compact, so Lore can act as the primary memory layer with little prompt competition. |
| **Claude Code** | `claudecode-plugin/` | MCP tools, session-start boot injection, per-prompt recall injection, and guidance rules. |
| **Codex** | `codex-plugin/` | Local marketplace plugin, MCP config, and optional hooks for boot / recall injection. |
| **OpenClaw** | `openclaw-plugin/` | Runtime plugin with boot, recall, and Lore tools. |
| **Hermes** | `hermes-plugin/` | MemoryProvider plugin with Lore tools and recall support. |
| **OpenCode** *(prerelease `v1.3.15-pre.4`)* | `opencode-plugin/` | Native plugin tested with OpenCode 1.18.3. Boot uses `experimental.chat.system.transform`; prompt Recall uses `chat.message`; exact `lore_*` tools are registered without MCP prefixes. |
| **Generic MCP clients** | `/api/mcp` | Streamable HTTP MCP endpoint for clients that can connect to remote tools. |

Most agent memory systems stop at retrieval. Lore focuses on the full memory lifecycle:

- **Boot baseline** — every session starts with stable identity, workflow, user, and runtime memories.
- **Recall before reply** — the agent receives a small `<recall>` block with relevant candidates before answering.
- **Read before trust** — recalled candidates are cues; the agent opens the memory node before relying on it.
- **URI-first graph** — memories live at durable URIs such as `core://agent`, `preferences://user`, and `project://my_project`.
- **Disclosure triggers** — each memory carries a natural-language condition that explains when it should surface.
- **Policy-guided writes** — priority budgets, disclosure quality checks, and boot-node protection keep the graph stable.
- **Dream maintenance** — scheduled review can inspect recall quality, structure, and stale nodes with rollback history.

Lore is built for agents that need continuity across sessions, tools, and runtimes.

---

## 3. Quick Start

### 1. Run the install script

```bash
npx @loremem/cli
```

Chinese installer output:

```bash
npx @loremem/cli --lang zh
```

This single command starts the Lore server (Docker Compose), connects all 6 agent runtimes,
and creates `~/.lore/config.json`. Re-run anytime to update.
Docker Compose pull/start output is shown; other installer subcommands stay quiet. OpenCode is included in the default channel set and is skipped successfully when the `opencode` CLI is absent.

| Flag | Description |
|---|---|
| `--pre` | Pre-release channel (`pre-latest` Docker tag) |
| `--dev` | Dev channel (`dev-latest` Docker tag) |
| `--channels CH,...` | Specific runtimes: `claudecode`, `codex`, `pi`, `openclaw`, `hermes`, `opencode` |
| `--base-url URL` | External server URL (skips local Docker) |
| `--skip-docker` | Don't start or manage Docker |
| `--force` | Force reinstall even if version unchanged |

### 2. Complete first-run setup

After the server is running, open:

```text
http://127.0.0.1:18901/setup
```

Complete the setup flow:

1. **Embedding setup** — configure an OpenAI-compatible embedding endpoint.
   - `Embedding Base URL`, for example `http://host.docker.internal:8090/v1`
   - `Embedding API Key`
   - `Embedding Model`, for example `text-embedding-3-small`
2. **View LLM setup** — configure the model used by view refinement and Dream.
   - `View LLM Base URL`
   - `View LLM API Key`
   - `View LLM Model`, for example `deepseek-v4-flash`
3. **Global boot memories** — review or save defaults for:
   - `core://agent`
   - `core://soul`
   - `preferences://user`
4. **Channel agent memories** — review or save defaults for runtime-specific memories:
   - `core://agent/claudecode`
   - `core://agent/codex`
   - `core://agent/openclaw`
   - `core://agent/hermes`
   - `core://agent/pi`
   - `core://agent/opencode`

The `Skip` button saves the default value for an empty boot node and moves forward.

### 3. Configure optional runtime settings

Open `/settings` after setup for:

- recall scoring weights and thresholds
- View LLM for view refinement and Dream
- Dream schedule
- backup settings
- write policy settings

Embedding is required for semantic recall and index rebuilds. View LLM is required during setup so Dream and view refinement are ready when you enable them.

---

## 4. Manual Setup

### Docker Compose

Create a `docker-compose.yml`:

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

  web:
    image: fffattiger/lore:latest
    restart: unless-stopped
    pull_policy: always
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      TZ: ${TZ:-Asia/Shanghai}
      DATABASE_URL: postgresql://${POSTGRES_USER:-lore}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-lore}
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

### Source build

```bash
git clone https://github.com/FFatTiger/lore.git
cd lore
docker compose up -d --build
```

---

## 5. Connect agents

The [Quick Start](#3-quick-start) install script handles this automatically. To connect
agents to an external server, use `--base-url`. After installing, restart each agent runtime.

### CLI options

```bash
# Stable (default)
npx @loremem/cli

# Chinese output
npx @loremem/cli --lang zh

# Pre-release channel
npx @loremem/cli install --pre

# Dev channel
npx @loremem/cli install --dev

# External server (skip local Docker)
npx @loremem/cli install --base-url http://192.168.1.100:18901 --api-token my-token

# OpenCode prerelease only (v1.3.15-pre.4)
npx @loremem/cli install --pre --channels opencode

# Specific channels only
npx @loremem/cli install --channels claudecode,codex
```

Full options:

| Flag | Description |
|---|---|
| `--base-url URL` | Lore server base URL (auto-starts Docker if omitted) |
| `--api-token TOKEN` | Lore API token |
| `--channels CH,...` | Comma-separated: `claudecode`, `codex`, `pi`, `openclaw`, `hermes`, `opencode`. Default: all 6 |
| `--dev` | Use dev channel (`dev-latest` Docker tag) |
| `--pre` | Use pre-release channel (`pre-latest` Docker tag) |
| `--skip-docker` | Don't start or update Docker containers |
| `--force` | Force reinstall even if version unchanged |

Re-run the install script anytime to update. If Docker was auto-started on first install, it will be updated automatically.



### Legacy (frozen)

The old `curl | bash` installers under `scripts/install.sh` remain available for compatibility but are **frozen** and no longer receive new features. Prefer `npx @loremem/cli`.

```bash
# legacy only
curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.sh | bash
```

### What each runtime gets

| Runtime | Integration |
|---|---|
| **Claude Code** | Marketplace plugin, MCP tools, SessionStart boot injection, per-prompt recall via server-driven lifecycle hooks |
| **Codex** | Local marketplace plugin, MCP config, boot/recall hooks |
| **Pi** | Extension tools, startup boot + recall context |
| **OpenClaw** | Runtime plugin with boot, recall, and Lore tools |
| **Hermes** | MemoryProvider plugin, tools, recall support |
| **OpenCode** *(prerelease)* | Native local plugin at `~/.config/opencode/plugins/lore-memory.js`; exact tools from `lore_guidance` through `lore_move_node`; system-hook Boot and message-hook Recall |
| **Generic MCP** | `http://your-host:18901/api/mcp?client_type=mcp` |

> **OpenCode prerelease note:** `v1.3.15-pre.4` is tested with OpenCode 1.18.3. The installer downloads `lore-opencode.zip`, installs `lore-memory.js` at `~/.config/opencode/plugins/lore-memory.js`, and reads server URL/token from `~/.lore/config.json`. Boot is injected only through `experimental.chat.system.transform`; prompt Recall is injected as a separate current-turn part through `chat.message`. If the experimental system hook or Lore is unavailable, the adapter fails open instead of blocking the conversation. The standard install does not configure MCP. The native plugin removes duplicate Lore MCP entries at runtime; when an existing user-level `oh-my-openagent.json[c]` or legacy `oh-my-opencode.json[c]` is safely parseable, the installer also sets `claude_code.plugins_override["lore@lore"] = false` to stop duplicate Claude Lore lifecycle hooks. It does not modify Claude Code files, warns and skips unsafe compatibility config, and restores the previous value on uninstall. Generic `/api/mcp` remains a manual fallback only; use `LORE_OPENCODE_ALLOW_MCP=1` for the explicit escape hatch.

> **Claude Code note:** Claude Code has a built-in auto-memory feature. The
> install script does not disable it — if you want Lore as your only memory
> system, set `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` or `"autoMemoryEnabled": false`
> in `~/.claude/settings.json`.

> **Codex note:** Restart Codex after installing. Open `/hooks` and trust Lore
> hooks if prompted. If `/plugins` still shows Lore as installable, install it
> manually there; the script has already configured MCP and user-level hooks.

---

## 6. Daily use

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

---

## 7. Development

```bash
cd web
cp .env.local.example .env.local
npm install
npm run dev
```

Requires Node.js 20+ and PostgreSQL with the `vector` extension.

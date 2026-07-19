<p align="center">
  <img src="docs/assets/lore-logo.svg" alt="Lore logo" width="96">
</p>

<h1 align="center">Lore（一个打通所有 agent 的记忆系统）</h1>

[English README](./README.md) · [Quick Start](#3-quick-start) · [手动安装](#4-手动安装) · [接入 agent](#5-接入-agent) · [CLI 选项](#cli-选项) · [日常使用](#6-日常使用) · [开发](#7-开发)

## 1. 截图

<p align="center">
  <img src="docs/screenshots/recall-analytics.jpg" alt="Recall Analytics">
</p>

| Recall Workbench | Memory Browser | Dream Diary |
|:-:|:-:|:-:|
| ![Recall Workbench](docs/screenshots/recall-workbench.jpg) | ![Memory Browser](docs/screenshots/memory-browser.jpg) | ![Dream Diary](docs/screenshots/dream-diary.jpg) |

---

## 2. 设计理念

Lore 是给 AI agent 用的长期记忆系统。它提供持久记忆图谱、固定启动基线、每轮 prompt 前召回、采用记录和谨慎写入工具。

当前支持的运行时：

| Runtime | 接入方式 | 说明 |
|---|---|---|
| **Pi** | `pi-extension/` | 适配性最好。Pi 把长期记忆交给 extension 承载，系统提示词更简洁，Lore 可以成为主记忆层，prompt 竞争更少。 |
| **Claude Code** | `claudecode-plugin/` | MCP tools、SessionStart boot 注入、每轮 prompt recall 注入和 guidance rules。 |
| **Codex** | `codex-plugin/` | 本地 marketplace plugin、MCP 配置，以及可选 boot / recall injection hooks。 |
| **OpenClaw** | `openclaw-plugin/` | runtime plugin，提供 boot、recall 和 Lore tools。 |
| **Hermes** | `hermes-plugin/` | MemoryProvider plugin，提供 Lore tools 和 recall 支持。 |
| **OpenCode** *（预发布 `v1.3.15-pre.3`）* | `opencode-plugin/` | 原生插件，已用 OpenCode 1.18.3 验证。Boot 走 `experimental.chat.system.transform`，prompt Recall 走 `chat.message`，原生 `lore_*` 工具不会带 MCP 前缀。 |
| **通用 MCP client** | `/api/mcp` | Streamable HTTP MCP endpoint，适合能连接远程 tools 的客户端。 |

Lore 关注完整的记忆生命周期：

- **Boot baseline** — 每次会话启动时加载稳定的身份、工作流、用户和运行时记忆。
- **Recall before reply** — agent 回答前收到一个很小的 `<recall>` 候选块。
- **Read before trust** — recall 只是线索，真正采用前需要打开记忆节点读取正文。
- **URI-first graph** — 记忆有稳定 URI，比如 `core://agent`、`preferences://user`、`project://my_project`。
- **Disclosure triggers** — 每条记忆都有自然语言触发条件，说明它该在什么场景浮现。
- **Policy-guided writes** — priority 容量、disclosure 质量检查、boot 节点保护，让记忆图谱保持稳定。
- **Dream maintenance** — 定时整理可以检查召回质量、结构放置和过期节点，并保留 rollback 历史。

Lore 面向需要跨会话、跨工具、跨运行时连续性的 agent。

---

## 3. Quick Start

### 1. 运行安装脚本

```bash
curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.zh.sh | bash
```

一条命令完成：启动 Lore 服务器（Docker Compose）、接入全部 6 个 agent 运行时、
创建 `~/.lore/config.json`。随时重新运行即可更新。
脚本会保留 Docker Compose 的 pull/start 输出，其他子命令默认静默，只输出关键状态。OpenCode 默认包含在 channel 列表中；如果没有安装 `opencode` CLI，会成功跳过，不影响其他 channel。

| 参数 | 说明 |
|---|---|
| `--pre` | 尝鲜版（`pre-latest` Docker tag） |
| `--dev` | 开发版（`dev-latest` Docker tag） |
| `--channels CH,...` | 指定运行时：`claudecode`、`codex`、`pi`、`openclaw`、`hermes`、`opencode` |
| `--base-url URL` | 外部服务器地址（跳过本地 Docker） |
| `--skip-docker` | 不启动或管理 Docker |
| `--force` | 强制重装（即使版本已是最新） |

### 2. 完成首次初始化

服务器启动后打开：

```text
http://127.0.0.1:18901/setup
```

按流程完成：

1. **Embedding setup** — 配置 OpenAI-compatible embedding endpoint。
   - `Embedding Base URL`，例如 `http://host.docker.internal:8090/v1`
   - `Embedding API Key`
   - `Embedding Model`，例如 `text-embedding-3-small`
2. **View LLM setup** — 配置 view refinement 和 Dream 使用的模型。
   - `View LLM Base URL`
   - `View LLM API Key`
   - `View LLM Model`，例如 `deepseek-v4-flash`
3. **全局 boot 记忆** — 检查或保存默认值：
   - `core://agent`
   - `core://soul`
   - `preferences://user`
4. **Channel agent 记忆** — 检查或保存各运行时专属默认值：
   - `core://agent/claudecode`
   - `core://agent/codex`
   - `core://agent/openclaw`
   - `core://agent/hermes`
   - `core://agent/pi`
   - `core://agent/opencode`

`Skip` 会给空 boot 节点写入默认值，并进入下一步。

### 3. 配置可选运行参数

初始化完成后打开 `/settings` 配置：

- recall scoring 权重和阈值
- View LLM，用于 view refinement 和 Dream
- Dream 定时计划
- 备份设置
- 写入策略

语义 recall 和索引重建需要 Embedding。初始化阶段要求配置 View LLM，让 Dream 和 view refinement 在启用时直接可用。

---

## 4. 手动安装

### Docker Compose

创建 `docker-compose.yml`：

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

### 源码构建

```bash
git clone https://github.com/FFatTiger/lore.git
cd lore
docker compose up -d --build
```

---

## 5. 接入 agent

[Quick Start](#3-quick-start) 中的安装脚本会自动完成接入。如需连接外部服务器，
使用 `--base-url`。安装完成后重启各 agent 运行时。

### CLI 选项

```bash
# 稳定版（默认）
curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.zh.sh | bash

# 尝鲜版
curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.zh.sh | bash -s -- --pre

# 开发版
curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.zh.sh | bash -s -- --dev

# 外部服务器（跳过本地 Docker）
curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.zh.sh | bash -s -- --base-url http://192.168.1.100:18901 --api-token my-token

# 只安装 OpenCode 预发布版（v1.3.15-pre.3）
curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.zh.sh | bash -s -- --pre --channels opencode

# 只安装指定 channel
curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.zh.sh | bash -s -- --channels claudecode,codex
```

完整选项：

| 参数 | 说明 |
|---|---|
| `--base-url URL` | Lore 服务器地址（不指定则自动启动 Docker） |
| `--api-token TOKEN` | Lore API token |
| `--channels CH,...` | 逗号分隔：`claudecode`、`codex`、`pi`、`openclaw`、`hermes`、`opencode`。默认全部 6 个 |
| `--dev` | 使用 dev 通道（`dev-latest` Docker tag） |
| `--pre` | 使用 pre-release 通道（`pre-latest` Docker tag） |
| `--skip-docker` | 不启动或更新 Docker 容器 |
| `--force` | 强制重装（即使版本已是最新） |

随时重新运行安装脚本即可更新。首次安装时由脚本自动启动的 Docker 会在更新时自动拉取最新镜像。

### 各运行时接入内容

| Runtime | 接入方式 |
|---|---|
| **Claude Code** | Marketplace 插件、MCP tools、通过服务端生命周期 hooks 注入 SessionStart boot 和每轮 recall |
| **Codex** | 本地 marketplace 插件、MCP 配置、boot/recall hooks |
| **Pi** | Extension tools、启动 boot + recall 上下文 |
| **OpenClaw** | Runtime plugin，提供 boot、recall 和 Lore tools |
| **Hermes** | MemoryProvider 插件、tools、recall 支持 |
| **OpenCode** *（预发布）* | `~/.config/opencode/plugins/lore-memory.js` 下的原生本地插件；精确注册 `lore_guidance` 到 `lore_move_node`；system hook 注入 Boot、message hook 注入 Recall |
| **通用 MCP** | `http://your-host:18901/api/mcp?client_type=mcp` |

> **OpenCode 预发布注意：** `v1.3.15-pre.3` 已用 OpenCode 1.18.3 验证。安装器下载 `lore-opencode.zip`，把 `lore-memory.js` 安装到 `~/.config/opencode/plugins/lore-memory.js`，服务器 URL/token 读取自 `~/.lore/config.json`。Boot 只通过 `experimental.chat.system.transform` 注入；prompt Recall 通过 `chat.message` 作为当前轮独立 part 注入。实验性 system hook 或 Lore 不可用时，插件会警告并 fail open，不会阻塞会话，prompt Recall 仍会继续尝试。标准安装不配置 MCP；通用 `/api/mcp` 仅作为手动兜底。

> **Claude Code 注意：** Claude Code 自带 auto-memory 功能，安装脚本不会关闭它。
> 如果希望 Lore 作为唯一记忆系统，请设置 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`
> 或在 `~/.claude/settings.json` 中设置 `"autoMemoryEnabled": false`。

> **Codex 注意：** 安装后请重启 Codex，打开 `/hooks` 并按提示 trust Lore hooks。
> 如果 `/plugins` 仍提示 Lore 可安装，在那里手动安装即可；脚本已经配置好 MCP 和用户级 hooks。

---

## 6. 日常使用

agent 接入后，工作流是：

1. 会话启动时加载 boot memories
2. 用户 prompt 前收到 `<recall>` candidates
3. 用 `lore_get_node` 打开相关节点
4. 有值得跨会话保留的信息时创建或更新长期记忆
5. 在 Web UI 里检查 recall 质量、历史、设置、备份和 Dream 整理结果

常用页面：

- `/memory` — 浏览和编辑记忆图谱
- `/recall` — 检查检索阶段和评分
- `/dream` — 运行结构整理
- `/settings` — 配置运行参数

---

## 7. 开发

```bash
cd web
cp .env.local.example .env.local
npm install
npm run dev
```

需要 Node.js 20+ 和带 `vector` extension 的 PostgreSQL。

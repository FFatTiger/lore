<p align="center">
  <img src="docs/assets/lore-logo.svg" alt="Lore logo" width="96">
</p>

# Lore

<p align="center">
  <strong>一套打通多个 AI agent 的长期记忆系统。</strong>
</p>

<p align="center">
  每次会话加载稳定基线，回答前召回相关记忆，<br>
  用可跨工具、跨重启、跨运行时的记忆图谱保持连续性。
</p>

<p align="center">
  <a href="https://loremem.com"><img src="https://img.shields.io/badge/website-loremem.com-0f766e?style=flat-square" alt="Website"></a>
  <a href="https://github.com/FFatTiger/lore/releases/latest"><img src="https://img.shields.io/github/v/release/FFatTiger/lore?style=flat-square&label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/FFatTiger/lore?style=flat-square" alt="MIT license"></a>
  <a href="https://hub.docker.com/r/fffattiger/lore"><img src="https://img.shields.io/badge/docker-fffattiger%2Flore-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker image"></a>
</p>

<p align="center">
  <a href="https://loremem.com"><strong>官网</strong></a> ·
  <a href="https://app.loremem.com"><strong>SaaS</strong></a> ·
  <a href="./README.md">English</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#支持的运行时">运行时</a> ·
  <a href="#手动安装">手动安装</a> ·
  <a href="#开发">开发</a>
</p>

<p align="center">
  <img src="docs/screenshots/recall-analytics.jpg" alt="Lore 召回分析面板" width="820">
</p>

| Recall Workbench | Memory Browser | Dream Diary |
|:-:|:-:|:-:|
| ![Recall Workbench](docs/screenshots/recall-workbench.jpg) | ![Memory Browser](docs/screenshots/memory-browser.jpg) | ![Dream Diary](docs/screenshots/dream-diary.jpg) |

## Lore 是什么

Lore 是给 coding agent 和其他 LLM 运行时用的自托管记忆服务。它提供持久记忆图谱、固定启动基线、每轮 prompt 前召回，以及受策略约束的写入工具。

很多记忆层只做检索。Lore 覆盖完整生命周期：

- **Boot** — 会话启动时加载身份、工作流、用户与运行时记忆
- **Recall** — 回答前注入一小段 `<recall>` 候选
- **读后再信** — 真正采用前先打开节点正文
- **URI-first graph** — 稳定地址，如 `core://agent`、`preferences://user`、`project://my_project`
- **Disclosure** — 每条记忆说明自己该在什么场景浮现
- **Dream** — 定时维护，带质量检查和回滚历史

## Quick Start

想直接用托管服务？去 [Loremem SaaS](https://app.loremem.com) 拿 token 连接 agent 即可，不用在本地跑 Docker。需要完全自托管时，再走下面的安装流程。

### 1. 安装

需要 Node.js 20+。

```bash
npx @loremem/cli --lang zh
```

英文输出版：

```bash
npx @loremem/cli
```

一条命令会：

- 需要时用 Docker Compose 启动 Lore（`postgres` + `redis` + `web`）
- 接入支持的 agent 运行时
- 写入 `~/.lore/config.json`

在 TTY 下直接跑 `npx @loremem/cli` 会进入交互安装；非交互场景请带上参数。随时重跑即可更新。本机没有对应 agent CLI 时会跳过，不影响其余渠道。

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--pre` | 尝鲜版（`pre-latest` 镜像） |
| `--dev` | 开发版（`dev-latest` 镜像） |
| `--channels CH,...` | 只装部分运行时：`claudecode`、`codex`、`pi`、`openclaw`、`hermes`、`opencode` |
| `--base-url URL` | 使用已有 Lore 服务，跳过本地 Docker |
| `--api-token TOKEN` | 服务端 API token |
| `--skip-docker` | 只配置 agent |
| `--force` | 即使版本未变也强制重装 |
| `--lang en\|zh` | 安装器语言 |

示例：

```bash
# 尝鲜版
npx @loremem/cli install --lang zh --pre

# 外部服务
npx @loremem/cli install --lang zh \
  --base-url http://192.168.1.100:18901 --api-token my-token

# 只装 Claude Code + Pi
npx @loremem/cli install --lang zh --channels claudecode,pi

# 之后更新 / 查看状态
npx @loremem/cli update
npx @loremem/cli status
```

### 2. 完成首次初始化

打开：

```text
http://127.0.0.1:18901/setup
```

按流程完成：

1. **Embedding** — OpenAI-compatible endpoint，用于语义召回
2. **View LLM** — 用于 view refinement 和 Dream 的模型
3. **全局 boot 记忆** — `core://agent`、`core://soul`、`preferences://user`
4. **Channel agent 记忆** — `core://agent/*` 下的运行时专属节点

`Skip` 会给空 boot 节点写入默认值，并进入下一步。

### 3. 成功标志

满足下面几条，就说明装好了：

1. `http://127.0.0.1:18901/setup` 走完
2. Web UI 可在 `http://127.0.0.1:18901` 打开
3. 重启已接入的 agent 后，会出现 Lore boot 上下文，后续 prompt 前能看到 `<recall>` 候选

需要再调 recall 权重、Dream 计划、备份或写入策略时，再打开 `/settings`。

## 支持的运行时

| 运行时 | 接入方式 | 你会得到什么 |
| --- | --- | --- |
| **Pi** | `pi-extension/` | extension tools、启动 boot、每轮 recall。想把 Lore 当主记忆层时优先选它 |
| **Claude Code** | `claudecode-plugin/` | marketplace plugin、MCP tools、SessionStart boot、每轮 recall hooks |
| **Codex** | `codex-plugin/` | 本地 marketplace plugin、MCP 配置、boot/recall hooks |
| **OpenClaw** | `openclaw-plugin/` | runtime plugin，提供 boot、recall 和 Lore tools |
| **Hermes** | `hermes-plugin/` | MemoryProvider plugin，提供 Lore tools 和 recall |
| **OpenCode** | `opencode-plugin/` | 原生插件，装到 `~/.config/opencode/plugins/lore-memory.js`，提供原生 `lore_*` 工具 |
| **通用 MCP** | `/api/mcp` | Streamable HTTP endpoint，适合能挂远程 tools 的客户端 |

安装后重启对应运行时。几个实用提醒：

- **Claude Code** 仍有内置 auto-memory。若只想用 Lore，设置 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`，或在 `~/.claude/settings.json` 写 `"autoMemoryEnabled": false`。
- **Codex** 可能要求你在 `/hooks` 里信任 Lore hooks。如果 `/plugins` 仍显示可安装，去那里装一次即可；脚本已经配好 MCP 和用户级 hooks。
- **OpenCode** 读取 `~/.lore/config.json`。本机没有 `opencode` CLI 时安装脚本会干净跳过。兼容细节见 [OpenCode 说明](#opencode-说明)。

通用 MCP URL：

```text
http://your-host:18901/api/mcp?client_type=mcp
```

## 日常使用

接入后，agent 工作流是：

1. 会话启动时加载 boot 记忆
2. prompt 前收到 `<recall>` 候选
3. 用 `lore_get_node` 打开相关节点
4. 值得跨会话保留的内容再创建或更新记忆
5. 用 Web UI 编辑图谱、检查召回、跑 Dream、做备份和设置

常用页面：

| 路径 | 用途 |
| --- | --- |
| `/memory` | 浏览和编辑记忆图谱 |
| `/recall` | 查看检索阶段和打分 |
| `/dream` | 做结构维护 |
| `/settings` | 配置运行参数 |

## 手动安装

只想自己跑服务时走这条路径。

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

然后把 agent 指到这台服务：

```bash
npx @loremem/cli install --lang zh \
  --base-url http://127.0.0.1:18901 --skip-docker
```

### 源码构建

```bash
git clone https://github.com/FFatTiger/lore.git
cd lore
docker compose up -d --build
```

## 开发

应用代码和 `package.json` 在 `web/` 目录。

```bash
cd web
cp .env.local.example .env.local
npm install
npm run dev
```

环境要求：

- Node.js 20+
- 带 `vector` 扩展的 PostgreSQL
- Redis 可选；未配置或不可达时，Lore 会回退到本地 LRU cache

在 `web/` 下可用：

```bash
npm run typecheck
npm test
```

包结构和贡献流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 卸载

```bash
npx @loremem/cli uninstall
```

```bash
# 指定运行时
npx @loremem/cli uninstall --channels claudecode,pi

# 连配置和 Docker 数据一起清掉
npx @loremem/cli uninstall --purge -y
```

<details>
<summary>旧版 shell 安装器</summary>

`scripts/install.sh`、`scripts/install.zh.sh`、`scripts/uninstall.sh` 仍可用于兼容，但已 **frozen**，不再加新功能。请优先使用 `npx @loremem/cli`。

```bash
# 仅兼容路径
curl -fsSL https://raw.githubusercontent.com/FFatTiger/lore/main/scripts/install.zh.sh | bash
```

</details>

## OpenCode 说明

<details>
<summary>原生插件路径、兼容层覆盖和 MCP 逃生口</summary>

安装脚本会把 `lore-memory.js` 放到 `~/.config/opencode/plugins/lore-memory.js`，并从 `~/.lore/config.json` 读取服务地址和 token。

Boot 通过 `experimental.chat.system.transform` 注入。Prompt recall 通过 `chat.message` 作为当前轮次内容注入。如果实验性 system hook 或 Lore 不可用，适配器会 fail open，不阻断对话。

标准安装不会配置 OpenCode MCP。原生插件会在运行时移除重复的 Lore MCP 条目。当用户级 `oh-my-openagent.json[c]` 或旧版 `oh-my-opencode.json[c]` 可安全解析时，安装脚本还会设置 `claude_code.plugins_override["lore@lore"] = false`，避免重复导入 Claude Lore lifecycle hooks。它不会修改 Claude Code 文件；遇到不安全配置会警告并跳过，卸载时恢复原值。

通用 `/api/mcp` 仍是手动回退路径。只有明确需要时，才设置 `LORE_OPENCODE_ALLOW_MCP=1`。

</details>

## 许可证

[MIT](./LICENSE)

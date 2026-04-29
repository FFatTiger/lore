# Contributing to Lore

感谢你对 Lore 的关注。本文档描述参与开发所需的约定和流程。

---

## 1. 项目结构

Monorepo，三个 package：

```
.
├── web/                   # Next.js 14 应用（server + frontend + MCP endpoint）
│   ├── app/               #   App Router 页面 & API routes
│   ├── server/lore/       #   核心业务逻辑（34+ modules，按功能拆分）
│   ├── components/        #   共享 UI 组件 (TSX)
│   └── lib/               #   前端工具函数
├── openclaw-plugin/       # OpenClaw 集成插件
├── claudecode-plugin/     # Claude Code 插件（CI 发布到 plugin 分支）
├── codex-plugin/          # Codex 插件源目录（CI 发布到 plugin 分支的 .agents/plugins + plugins/lore 布局）
├── pi-extension/          # Pi agent 扩展（本地安装，client_type=pi）
├── postgres/              # 自定义 PostgreSQL 镜像（pgvector + zhparser）
└── docker-compose.yml
```

`web/` 是核心。Server 代码按功能组织：`recall.ts`、`search.ts`、`dream*.ts`、`write.ts` 等，共享类型在 `types.ts`，常量在 `constants.ts`。

## 2. 开发环境搭建

### 前置条件

- Node.js 20+
- PostgreSQL 16（需启用 `vector` 扩展）
- Docker & Docker Compose（用于完整部署测试）

### 本地启动

```bash
# 1. 克隆仓库
git clone https://github.com/FFatTiger/lore.git
cd lore

# 2. 安装依赖
cd web
cp .env.local.example .env.local
# 编辑 .env.local，填写数据库连接和 embedding 配置
npm install

# 3. 启动开发服务器
npm run dev
```

### Docker 完整环境

```bash
cp .env.example .env
# 编辑 .env，至少修改 POSTGRES_PASSWORD
docker compose up -d
```

验证：`curl http://127.0.0.1:18901/api/health`

## 3. 代码风格

### TypeScript

- **strict mode**，不允许 `any` 泛滥（必要时用 `as any` 并加注释说明原因）
- 模块使用 **named export**，避免 default export

```typescript
// good
export function recallCandidates(...) { ... }
export interface RecallResult { ... }

// bad
export default function recallCandidates(...) { ... }
```

### 命名规范

| 位置 | 风格 | 示例 |
|------|------|------|
| TypeScript 变量/函数 | camelCase | `recallCandidates`, `viewWeight` |
| TypeScript 类型/接口 | PascalCase | `BootViewResult`, `CoreMemory` |
| 数据库列名 | snake_case | `node_uuid`, `created_at` |
| URI path segment | snake_case ASCII | `project://my_project` |

### Import 顺序

按以下分组排列，组间空行分隔：

```typescript
// 1. Node.js 内置模块
import { readFileSync } from 'fs';

// 2. 外部依赖
import { z } from 'zod';

// 3. 项目内绝对路径
import { sql } from '../db';

// 4. 相对路径（同目录 / 子目录）
import { parseUri } from './utils';
```

## 4. 版本管理

- 遵循 **Semver**（MAJOR.MINOR.PATCH）
- **唯一版本源**：`web/package.json` 的 `version` 字段（当前 `2.0.0`）
- Plugin 版本跟随 server 版本
- 版本号只在发布时修改，开发阶段不需要 bump

### Bump 流程

```bash
cd web
# 手动修改 package.json 中的 version
# 确保 claudecode-plugin、codex-plugin、openclaw-plugin 版本同步更新
```

发布版本时需要同步 `web/package.json`、`claudecode-plugin/.claude-plugin/plugin.json`、`codex-plugin/.codex-plugin/plugin.json`、`openclaw-plugin/openclaw.plugin.json` 和 `openclaw-plugin/package.json`。

## 5. 分支与 PR 规范

### 分支命名

```
feat/recall-decay-strategy
fix/dream-null-pointer
chore/update-dependencies
```

前缀：`feat/`、`fix/`、`chore/`、`refactor/`、`docs/`

### Commit Message

使用 **Conventional Commits** 格式：

```
<type>: <简短描述>

[可选正文]
```

Type 取值：

| Type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `chore` | 构建、依赖、配置等非功能性变更 |
| `refactor` | 重构（不改变外部行为） |
| `docs` | 文档 |
| `test` | 测试 |

示例：

```
feat: add recency decay to recall scoring
fix: filter deleted nodes from analytics queries
chore: bump vitest to v4.1.2
refactor: extract scoring strategies into standalone module
```

### PR 要求

- 必须包含 **描述**：改了什么、为什么改
- 必须包含 **测试证据**：新增/修改的测试，或手动测试的截图/日志
- 一个 PR 只做一件事，避免混合 feature 和 refactor

## 6. 测试

### 框架和约定

- **Vitest**（配置在 `web/` 目录下）
- 测试文件放在对应模块的 `__tests__/` 目录中
- 文件命名：`<模块名>.test.ts`

```
web/server/lore/__tests__/boot.test.ts      # 测试 boot.ts
web/server/lore/__tests__/recall.test.ts     # 测试 recall.ts
openclaw-plugin/__tests__/hooks.test.ts      # 测试 hooks.ts
```

### Mock 模式

`vi.mock()` 必须放在文件顶部、import 之前：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db', () => ({ sql: vi.fn() }));

import { sql } from '../../db';
import { bootView } from '../boot';

const mockSql = vi.mocked(sql);

describe('bootView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns core and recent memories', async () => {
    mockSql.mockResolvedValueOnce({ rows: [...], rowCount: 1 } as any);
    // ...
  });
});
```

### 运行测试

```bash
cd web
npm test          # 运行一次
npm run test:watch  # watch 模式
```

**所有 PR 必须通过测试。** 新增功能需要配套测试，bug fix 需要回归测试。

## 7. 发布流程

```
版本 bump → commit → push to main → CI 自动构建 → 部署
```

### 详细步骤

1. 在 `web/package.json` 中修改 `version`
2. Commit（`chore: bump version to x.y.z`）
3. Push 到 `main` 分支
4. GitHub Actions 自动触发（`.github/workflows/docker-build.yml`）：
   - 构建 `linux/amd64` + `linux/arm64` Docker 镜像
   - Push 到 Docker Hub：`fffattiger/lore:latest`、`:YYYYMMDD-HHMM`、`:sha-XXXXXXX`
5. 通过 Portainer 或 `docker compose pull && docker compose up -d` 部署

### CI 触发条件

Push 到 `main` 且修改了以下路径之一：
- `web/**`
- `claudecode-plugin/**`
- `codex-plugin/**`
- `.github/workflows/docker-build.yml`

---

有问题可以开 Issue 讨论，欢迎贡献。

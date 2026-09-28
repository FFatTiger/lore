# Lore local skills MCP (stdio)

Client-local MCP adapter that owns **all** `lore_skill_*` tools for Codex and Claude Code:

- `lore_skill_list`
- `lore_skill_search`
- `lore_skill_get` (fetches a skill into a local work copy on demand; returns `SKILL.md` + absolute `skill_dir`)
- `lore_skill_create`
- `lore_skill_update` (requires positive integer `expected_version`)
- `lore_skill_delete`
- `lore_skill_status` (local read-only; can list existing copies without contacting Core)

Remote Core MCP (`lore`) continues to serve memory tools only for these client types; skills are not duplicated.

## Run

```bash
node src/server.mjs --client-type codex
# or
LORE_CLIENT_TYPE=claudecode node src/server.mjs
```

Configuration is resolved from env / `~/.lore/config.json` (never put tokens in argv):

| Source | Keys |
|--------|------|
| Env | `LORE_HOME`, `LORE_BASE_URL`, `LORE_API_TOKEN`, `LORE_CLIENT_TYPE`, `LORE_TIMEOUT_MS` |
| Shared config | `base_url`, `api_token` |

HTTP calls go to `${LORE_BASE_URL}/api/skills*` with `Authorization: Bearer …` and `client_type=codex|claudecode`.

## Host protocol

- JSON-RPC 2.0 over stdio
- **Primary framing:** MCP/LSP `Content-Length` headers
- **Also accepted:** newline-delimited JSON (NDJSON); responses mirror the peer’s framing once detected
- Methods: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`
- Tool failures return `{ content, isError: true }` without crashing the process

## Packaging

Release ZIPs for Codex / Claude Code include this directory (and `vendor/skill-workcopy.mjs`). Two MCP servers are configured:

- remote HTTP MCP as `lore` (memory)
- local stdio MCP as `lore-skills` (skills): the Claude Code plugin declares it in its `.mcp.json`; the Codex installer adds it to `config.toml` only when the server advertises Skills

The server only exposes Skills to clients that expose these tools: the hooks send `features.skills` so Lore adds the session-start skill catalog and `$skill-name` invocations to the host output.

Work-copy materialization uses vendored helpers under `vendor/` (or `shared/skill-workcopy` when present in the monorepo) and stores local work copies at `${LORE_HOME:-~/.lore}/skill-artifacts/<project-id>/<skill-name>/`. Server-managed package files are read-only (0444); the skill directory itself stays writable so agents create local outputs and caches directly inside the same copy. Extra local files never trigger tamper and survive same-version fetches and version upgrades. A version mismatch updates only the managed package files. Downloads and updates happen on demand via `lore_skill_get` — there is no session-start bulk reconcile. `tools/list` and `tools/call` stay fail-closed when Skills are disabled.

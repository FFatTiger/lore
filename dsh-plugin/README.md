# Lore DeepSeek Harness (dsh) plugin

Official Lore channel for DeepSeek Harness: a native lifecycle plugin plus a local MCP bridge. No dsh runtime changes are required.

## Install from this directory

The Lore CLI wires everything up:

```bash
npx @loremem/cli install --channels dsh
```

The installer extracts this directory to `~/.lore/dsh/` and adds two rows with stable ids to the home-level `~/.dsh/cordis.patch.yml`, so every dsh profile picks them up:

```yaml
# >>> lore (managed) >>>
- insert:
    - id: lore-lifecycle
      name: /absolute/path/to/~/.lore/dsh/plugin/lifecycle.mjs
    - id: lore-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: lore
        transport: stdio
        command: node
        args:
          - /absolute/path/to/~/.lore/dsh/mcp/lore-mcp.mjs
# <<< lore (managed) <<<
```

dsh resolves absolute plugin paths in inserted rows itself, so no profile-local install is needed. Re-running the installer replaces only the rows between the markers and leaves every other row untouched. The token never appears in the patch file: the plugin and the bridge read `${LORE_HOME:-~/.lore}/config.json` (`base_url`, `api_token`), then `LORE_BASE_URL` / `LORE_API_TOKEN` / `API_TOKEN`. The default server is `http://127.0.0.1:18901`.

## Lifecycle plugin

`plugin/lifecycle.mjs` is a native Cordis plugin (plain ESM, Node built-ins only):

- On `agent/created` (every source: `startup`, `resume`, `clear`, `compact`) it POSTs a `session.start` lifecycle event and registers the returned boot context as a `lore:boot` system-prompt section on that agent's scoped context, so the text reaches only that session. A resumed session reuses the cached boot context without a second request; `clear` refetches.
- On the first `agent/pre-step` of a turn whose claimed batch ends with a user-authored message, it POSTs exactly one `prompt.submit` for that user message (never once per model step) and appends the returned recall context to that step's admitted messages, attributed to a `lore` producer with `form: recall` so dsh never presents it as user input.

All requests carry `runtime_id=dsh`, `runtime_family=dsh`, and the plugin version. Fail-open everywhere: Lore being unreachable, slow (`LORE_START_TIMEOUT_MS` / `LORE_PROMPT_TIMEOUT_MS`, default 8000/10000 ms), or returning an unknown shape never breaks the dsh session. Set `LORE_DEBUG=1` to print diagnostics to stderr.

## MCP bridge

The mcp-client row registers a stdio server named `lore` that forwards MCP JSON-RPC to the server's `/api/mcp?client_type=dsh`. Tools appear as `mcp__lore__<tool>`, for example `mcp__lore__lore_search`. dsh scrubs credential-shaped environment variables for stdio servers; the bridge does not need them because it reads its credentials from the Lore config file.

## Skills

Skills are fail-closed. They are enabled only when the connected server advertises `capabilities.skills=true`, which the installer records as `server_profile` in `config.json` for the same base URL. `LORE_SKILLS_ENABLED=0` forces them off; `LORE_SKILLS_ENABLED=1` enables them when no matching profile exists.

When Skills are enabled, a successful `lore_skill_get` materializes the server package under `${LORE_HOME:-~/.lore}/skills/<project-id>/<skill-name>/` like the other channels. Server-managed files are read-only and refreshed by later gets; any other file in the skill directory is a local artifact that is never checked or uploaded.

## Tests

```bash
node --test plugin/__tests__/*.test.mjs mcp/__tests__/*.test.mjs
```

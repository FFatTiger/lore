# Lore ZCode plugin

Native ZCode lifecycle hooks for Lore. This is a hooks-only plugin: no MCP servers and no skill wrapper.

## Install from this directory

```bash
zcode plugins marketplace add /absolute/path/to/lore/zcode-plugin
zcode plugins install lore@lore
zcode plugins enable lore@lore
```

Or with the Lore CLI after a release artifact exists:

```bash
npx @loremem/cli install --channels zcode
```

The plugin reads `~/.lore/config.json`, then `LORE_BASE_URL` / `LORE_API_TOKEN` / `API_TOKEN`. The default server is `http://127.0.0.1:18901`.

Hooks:

- `SessionStart` (`startup|resume|clear`, 8000ms): inject Lore boot context
- `UserPromptSubmit` (10000ms): inject Lore recall context for non-empty prompts

Lore/network/parse errors fail open: the hook exits 0 with empty stdout.

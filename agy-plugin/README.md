# Lore Antigravity CLI plugin

Lore provides an MCP bridge, session boot context, prompt recall and native skills for Antigravity CLI.

```bash
agy plugin install /absolute/path/to/agy-plugin
agy plugin enable lore
# Or install the release with the Lore CLI:
npx -y @loremem/cli install --channels agy
```

The plugin reads `${LORE_HOME:-~/.lore}/config.json` and the standard Lore environment variables. SessionStart forwards project context to Lore and synchronizes enabled skills in the installed plugin in the background. PreInvocation forwards the first invocation of each non-empty user prompt. Lore's host-ready JSON is passed through; errors produce `{}`. The MCP bridge uses `client_type=agy`.

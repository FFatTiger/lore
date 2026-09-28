# @loremem/cli

`@loremem/cli` is the supported installer and manager for Lore agent runtime integrations. The legacy `scripts/install.sh` path remains available as frozen compatibility code, but new install behavior is implemented here.

## Install or connect

```bash
# Interactive setup
npx @loremem/cli

# Loremem SaaS — an API token is required
npx @loremem/cli install \
  --base-url https://api.loremem.com \
  --api-token lm_...

# Another external Lore server
npx @loremem/cli install \
  --base-url https://core.example \
  --api-token lm_...

# Plain HTTP on a non-loopback host is unsafe and requires explicit per-run approval.
# The token can be intercepted or modified in transit; prefer HTTPS.
npx @loremem/cli install \
  --base-url http://192.168.1.100:18901 \
  --api-token lm_... \
  --allow-insecure-http

# Install a subset of integrations from the prerelease channel
npx @loremem/cli install --channels pi,opencode --pre
```

A token-bearing remote connection must use HTTPS by default. Plain HTTP is automatically allowed only for loopback development servers such as `localhost`, `127.0.0.1`, or `::1`. For a non-loopback HTTP server, parameter mode requires the explicit, runtime-only `--allow-insecure-http` flag; `--yes` does not grant this permission. The interactive wizard instead shows a separate default-No risk confirmation. This approval is never saved to config.

## Update, status, and uninstall

```bash
npx @loremem/cli update
npx @loremem/cli status
npx @loremem/cli uninstall --channels opencode -y
npx @loremem/cli uninstall --purge -y
```

By default, `update` targets integrations whose local state is `installed` or `partial`. It fails instead of claiming success when the target GitHub release cannot be resolved, a selected integration fails, or a selected integration is skipped. Use `--channels` to select update targets explicitly.

## Connection and token safety

Shared connection settings are stored in `~/.lore/config.json`; set `LORE_HOME` to override the Lore state directory.

- Files containing Lore credentials are written with mode `0600`.
- A saved token is reused only when the normalized server URL is unchanged.
- Changing the server without supplying a replacement token clears the old token.
- Loremem SaaS requires a token in both interactive and non-interactive setup.
- Non-loopback HTTP with a token is rejected unless explicitly approved for the current run with `--allow-insecure-http` or the wizard's separate risk confirmation.
- `--allow-insecure-http` is not persisted, and `--yes` never implies it.
- Existing malformed host configuration is rejected instead of being overwritten as an empty configuration.

Passing `--api-token` places the token in the process arguments and may leave it in shell history. Use the normal secret-handling controls for your environment.

## Codex hooks

Codex uses the hooks bundled with the Lore plugin by default. The installer removes obsolete Lore entries from user-level `~/.codex/hooks.json` while preserving unrelated hooks, preventing duplicate lifecycle execution.

Set the following only for an older Codex build that requires legacy user-level compatibility hooks:

```bash
LORE_CODEX_INSTALL_USER_HOOKS=1 npx @loremem/cli install \
  --base-url https://api.loremem.com \
  --api-token lm_... \
  --channels codex
```

## Channel behavior

- Claude Code, Codex, Pi, OpenClaw, OpenCode, and ZCode require their corresponding host CLI for automatic setup.
- Hermes downloads and prepares the `lore_memory` files, but linking them into the Hermes skills/plugin path is a manual step.
- Missing host CLIs are reported as skipped rather than silently treated as configured.
- Required marketplace, MCP, build, plugin, compatibility, and Docker commands report failures with bounded, token-redacted diagnostics.

## Requirements and platform support

The current installer supports macOS and Linux. Some integrations still invoke POSIX shell scripts and are not Windows-native.

- Node.js 20 or newer
- Bash for Bash-dependent integration helpers
- `curl` and `unzip` for GitHub release artifacts
- Host CLIs for the selected integrations (`claude`, `codex`, `pi`, `openclaw`, `opencode`, `zcode`, and others as applicable)
- Docker plus Docker Compose only for local self-host mode
- Python 3 for optional OpenCode compatibility handling when that compatibility state is present

## Known deferred limitations

The Codex installer repairs Lore hook paths in the marketplace source, local cache, and versioned Codex cache entries on every install or update, and replaces an older `lore` marketplace source when necessary.

The following are intentionally not part of the `1.3.20` safety patch:

- per-channel artifact version markers and mixed-version recovery;
- fully layered status checks for artifact, host plugin, MCP, hooks, and runtime health;
- redesign of subset purge and the complete Docker shutdown/data lifecycle;
- Windows-native installers that remove the remaining Bash dependencies.

The frozen curl installer remains a compatibility fallback, not a second evolving implementation. The `npx @loremem/cli` entrypoint is the source of supported install, update, uninstall, and status behavior.

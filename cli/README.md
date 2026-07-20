# @loremem/cli

Interactive installer and manager for Lore agent runtime integrations.

## Install / connect

```bash
# interactive
npx @loremem/cli

# non-interactive (SaaS / external server)
npx @loremem/cli install --base-url https://core.example --api-token lm_...

# subset of channels
npx @loremem/cli install --channels pi,opencode --pre
```

## Update / uninstall / status

```bash
npx @loremem/cli update
npx @loremem/cli status
npx @loremem/cli uninstall --channels opencode -y
npx @loremem/cli uninstall --purge -y
```

## Requirements

- Node.js >= 20
- Host CLIs for selected channels (`claude`, `codex`, `pi`, `openclaw`, `opencode`, …)
- `curl` and `unzip` for GitHub release artifacts
- Docker only for local self-host mode

Config is stored in `~/.lore/config.json` (`LORE_HOME` overrides).

Legacy shell installers under `scripts/install.sh` are frozen; this package is the supported entrypoint.

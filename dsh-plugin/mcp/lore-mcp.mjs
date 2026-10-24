#!/usr/bin/env node

import { runLoreMcpBridge } from '../vendor/mcp-bridge/index.mjs';

// Plain forwarding: skills are discovered through dsh's native skill system
// (the lifecycle plugin registers a ctx.skills provider over the synced
// ~/.lore/skills/<project-id>/ directory), so no skill-package response
// needs local materialization anymore.
runLoreMcpBridge({ clientType: 'dsh' });

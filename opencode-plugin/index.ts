import type { Plugin } from '@opencode-ai/plugin';
import { loadLorePluginConfig } from './config.js';
import { createOpenCodeLifecycleAdapter } from './lifecycle.js';
import { suppressDuplicateLoreMcp } from './mcp.js';
import { createLoreTools } from './tools.js';

const loreOpenCodePlugin: Plugin = async ({ directory, worktree }) => {
  const config = loadLorePluginConfig();
  const adapter = createOpenCodeLifecycleAdapter({ config, directory, worktree });
  return {
    ...adapter.hooks,
    config: async (mergedConfig) => {
      suppressDuplicateLoreMcp(mergedConfig, config);
    },
    tool: createLoreTools(config, { skillsEnabled: config.skillsEnabled }),
  };
};

export default loreOpenCodePlugin;

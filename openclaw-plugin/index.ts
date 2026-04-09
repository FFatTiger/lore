import { pickPluginConfig } from './api';
import { registerTools } from './tools';
import { registerHooks, loadPromptGuidance } from './hooks';

const GUIDANCE = loadPromptGuidance();

export default function register(api: any) {
  const pluginCfg = pickPluginConfig(api);
  registerTools(api, pluginCfg);
  registerHooks(api, pluginCfg, GUIDANCE);
}

// Re-export from modules for testing and backward compatibility
export { parseMemoryUri, resolveMemoryLocator, splitParentPathAndTitle, trimSlashes, sameLocator } from './uri';
export { formatNode, formatBootView, formatRecallBlock, readCueList, normalizeSearchResults, normalizeKeywordList, normalizeUriList } from './formatters';
export { textResult, pickPluginConfig } from './api';

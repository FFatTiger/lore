import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { pickPluginConfig, textResult } from './api';
import { registerTools } from './tools';
import { loadPromptGuidance, registerHooks } from './hooks';

export default function lorePiExtension(pi: ExtensionAPI) {
  const pluginCfg = pickPluginConfig(pi);
  const guidance = loadPromptGuidance();
  registerTools(pi, pluginCfg);
  registerHooks(pi, pluginCfg, guidance);
}

export { pickPluginConfig, textResult };
export { parseMemoryUri, resolveMemoryLocator, splitParentPathAndTitle, trimSlashes, sameLocator } from './uri';
export { formatNode, formatBootView, formatRecallBlock } from './formatters';

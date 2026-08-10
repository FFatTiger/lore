import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { pickPluginConfig, textResult } from './api';
import { registerTools } from './tools';
import { registerHooks } from './hooks';
import { createSkillsSession } from './skills';

export default function lorePiExtension(pi: ExtensionAPI) {
  const pluginCfg = pickPluginConfig(pi);
  const skillsSession = createSkillsSession(pluginCfg);
  registerTools(pi, pluginCfg, skillsSession);
  registerHooks(pi, pluginCfg, skillsSession);
}

export { pickPluginConfig, textResult };
export { parseMemoryUri, resolveMemoryLocator, splitParentPathAndTitle, trimSlashes, sameLocator } from './uri';
export { formatNode, formatBootView, formatRecallBlock } from './formatters';
export {
  createSkillsSession,
  registerSkillTools,
  resolveLoreHome,
  validateSafeRelativePath,
  computeManifestHash,
  ensureSkillWorkCopy,
  materializeSkillWorkCopy,
} from './skills';

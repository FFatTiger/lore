import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { pickPluginConfig, textResult } from './api';
import { registerTools } from './tools';
import { registerHooks } from './hooks';
import { createSkillsSession, registerSkillResourceDiscovery } from './skills';

export default function lorePiExtension(pi: ExtensionAPI) {
  const pluginCfg = pickPluginConfig(pi);
  const skillsSession = pluginCfg.skillsEnabled ? createSkillsSession(pluginCfg) : undefined;
  if (skillsSession) registerSkillResourceDiscovery(pi, pluginCfg, skillsSession);
  registerTools(pi, pluginCfg, skillsSession);
  registerHooks(pi, pluginCfg);
}

export { pickPluginConfig, textResult };
export { parseMemoryUri, resolveMemoryLocator, splitParentPathAndTitle, trimSlashes, sameLocator } from './uri';
export { formatNode, formatBootView, formatRecallBlock } from './formatters';
export {
  createSkillsSession,
  registerSkillTools,
  registerSkillResourceDiscovery,
  resolveLoreHome,
  validateSafeRelativePath,
  computeManifestHash,
  ensureSkillWorkCopy,
  materializeSkillWorkCopy,
} from './skills';

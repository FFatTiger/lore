import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { pickPluginConfig } from "./api";
import { registerTools } from "./tools";
import { registerHooks } from "./hooks";
import { createSkillsSession } from "./skills";

export default definePluginEntry({
  id: "lore",
  name: "Lore",
  description: "Primary Lore memory system for fixed boot baseline, recall, cross-session project knowledge, and skill work copies.",
  register(api) {
    try {
      api.logger.info(`lore: register() start, cfg keys: ${Object.keys(api?.pluginConfig ?? {}).join(",") || "none"}`);
      const pluginCfg = pickPluginConfig(api);
      api.logger.info(`lore: baseUrl=${pluginCfg.baseUrl}, recall=${pluginCfg.recallEnabled}, loreHome=${pluginCfg.loreHome}`);
      const skillsSession = pluginCfg.skillsEnabled ? createSkillsSession(pluginCfg) : undefined;
      registerTools(api, pluginCfg, skillsSession);
      api.logger.info(`lore: tools registered ok`);
      registerHooks(api, pluginCfg, skillsSession);
      api.logger.info(`lore: hooks registered ok`);
    } catch (e: any) {
      api.logger.error(`lore: register() FAILED: ${e.message}\n${e.stack}`);
      throw e;
    }
  },
});

// Re-export from modules for testing and backward compatibility
export { parseMemoryUri, resolveMemoryLocator, splitParentPathAndTitle, trimSlashes, sameLocator } from "./uri";
export { formatNode, formatBootView, formatRecallBlock, readCueList, normalizeSearchResults, normalizeKeywordList, normalizeUriList } from "./formatters";
export { textResult, pickPluginConfig } from "./api";
export {
  createSkillsSession,
  ensureSkillWorkCopy,
  registerSkillTools,
} from "./skills";

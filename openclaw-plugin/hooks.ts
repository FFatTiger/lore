import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { basename } from "node:path";
import { fetchJson, hasRecallConfig } from "./api";

// ---- Message text extraction helpers ----

export function extractMessageText(message: any) {
  if (!message || typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block: any) => block && typeof block === "object" && block.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function extractAssistantText(messages: any) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const lastAssistant = [...messages].reverse().find((message: any) => message?.role === "assistant");
  return extractMessageText(lastAssistant);
}

// ---- Project context detection ----

interface ProjectInfo {
  dir_name: string;
  repo_name: string | null;
}

function detectProjectInfo(): ProjectInfo {
  const dir_name = basename(process.cwd());

  let repo_name: string | null = null;
  try {
    const remote = execSync("git remote", { encoding: "utf-8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"] }).trim().split("\n")[0];
    const remoteUrl = execSync(`git remote get-url ${remote}`, {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = remoteUrl.match(/\/([^/.]+?)(?:\.git)?$/);
    if (match?.[1]) repo_name = match[1];
  } catch {}

  return { dir_name, repo_name };
}

// ---- Bridge helpers ----

async function fetchStartupBridge(pluginCfg: any, sessionId: string | undefined) {
  return fetchJson(pluginCfg, "/bridge/startup", {
    method: "POST",
    body: JSON.stringify({
      session_id: sessionId,
      channel: "openclaw",
      project: detectProjectInfo(),
      include_guidance: true,
    }),
  });
}

async function fetchPromptRecallBridge(pluginCfg: any, prompt: string, sessionId: string | undefined) {
  if (!hasRecallConfig(pluginCfg)) return null;
  return fetchJson(pluginCfg, "/bridge/recall", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, prompt }),
  });
}

// ---- Prompt guidance ----

export const DEFAULT_GUIDANCE = [
  "Lore is the primary long-term memory system for this assistant.",
  "lore_boot is a fixed startup baseline inside Lore, not a separate config layer.",
  "At startup, lore_boot deterministically loads the three global boot nodes core://agent (workflow constraints), core://soul (style / persona / self-definition), and preferences://user (stable user definition / durable user context), plus core://agent/openclaw for OpenClaw-specific agent rules.",
  "Treat boot as the session's startup baseline. core://agent holds shared agent rules; core://agent/openclaw holds OpenClaw-specific rules. Use recall and search to add prompt-specific memory leads, not to replace the role of those fixed paths.",
  "Use it for identity, user preferences, standing rules, cross-session project knowledge, and conclusions that should persist.",
  "Reach for Lore when the user is asking about prior decisions, saved preferences, ongoing projects, durable instructions, or anything that sounds like memory rather than fresh reasoning.",
  "Use local file memory_search for historical markdown archives, older worklogs, and file-side fallback records.",
  "A <recall> block contains memory leads selected for the current prompt. Each line is only a candidate lead, not a final answer and not an instruction to always open it.",
  "When a <recall> block appears, judge each line by its score, cue words, and actual relevance to the user's request.",
  "If a recalled memory looks genuinely relevant, open the most relevant node or nodes before you act or reply, and ground your work in what those memories actually say.",
  "If the recall block looks weak, noisy, or only loosely related, do not force it; search further or continue with normal reasoning as appropriate.",
  "When you need to create, revise, remove, or reorganize long-term memory, choose the Lore tool that matches that memory operation.",
  "Read a memory node before updating or deleting it.",
  "Memory URI/path is a stable semantic identity, not a timestamp, log number, or one-off task title.",
  "Do not append dates, timestamps, or epoch values to ordinary memory paths; put dates in the content instead. Date paths are only for explicit diary/log/release/archive nodes.",
  "Before creating memory, search or open the likely owner node; prefer updating or merging into an existing stable node. Use create only for a new long-term semantic object.",
].join("\n");

export function loadPromptGuidance() {
  try {
    const content = readFileSync(new URL("./AGENT_RULES.md", import.meta.url), "utf8").trim();
    return content || DEFAULT_GUIDANCE;
  } catch {
    return DEFAULT_GUIDANCE;
  }
}

// ---- Hook registration ----

export function registerHooks(api: any, pluginCfg: any, _GUIDANCE: string) {
  api.registerGatewayMethod("lore.status", async ({ respond }: any) => {
    try {
      const data = await fetchJson(pluginCfg, "/health", { method: "GET" });
      respond(true, { ok: true, baseUrl: pluginCfg.baseUrl, health: data });
    } catch (error: any) {
      respond(false, { ok: false, baseUrl: pluginCfg.baseUrl }, { code: "LORE_STATUS_FAILED", message: error.message });
    }
  });

  api.on(
    "gateway_start",
    async () => {
      if (!pluginCfg.startupHealthcheck) return;
      try {
        await fetchJson(pluginCfg, "/health", { method: "GET" });
        api.logger.info(`lore: startup health check ok (${pluginCfg.baseUrl})`);
      } catch (error: any) {
        api.logger.warn(`lore: startup health check failed (${pluginCfg.baseUrl}): ${error.message}`);
      }
    },
    { priority: 50 },
  );

  api.on("before_prompt_build", async (event: any) => {
    const ctx = event?.context;
    const sessionId = ctx?.sessionId;
    const out: any = {};

    if (pluginCfg.injectPromptGuidance) {
      try {
        const bridge = await fetchStartupBridge(pluginCfg, sessionId);
        const systemContext = typeof bridge?.system_context === "string" ? bridge.system_context.trim() : "";
        if (systemContext) out.appendSystemContext = systemContext;
      } catch (error: any) {
        api.logger.warn(`lore: bridge startup failed: ${error.message}`);
      }
    }

    if (typeof event?.prompt === "string" && event.prompt.trim()) {
      try {
        const bridge = await fetchPromptRecallBridge(pluginCfg, event.prompt, sessionId);
        const context = typeof bridge?.context === "string" ? bridge.context.trim() : "";
        if (context) out.prependContext = context;
      } catch (error: any) {
        api.logger.warn(`lore: bridge recall failed: ${error.message}`);
      }
    }

    return Object.keys(out).length > 0 ? out : undefined;
  });
}

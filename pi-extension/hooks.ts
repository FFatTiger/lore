import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename } from 'node:path';
import { fetchJson, hasRecallConfig } from './api';

// ---- Message text extraction helpers ----

export function extractMessageText(message: any) {
  if (!message || typeof message !== 'object') return '';
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
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
    const remote = execSync('git remote', { encoding: 'utf-8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
    const remoteUrl = execSync(`git remote get-url ${remote}`, {
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const match = remoteUrl.match(/\/([^/.]+?)(?:\.git)?$/);
    if (match?.[1]) repo_name = match[1];
  } catch {}

  return { dir_name, repo_name };
}

// ---- Bridge helpers ----

async function fetchStartupBridge(pluginCfg: any, sessionId: string | undefined) {
  return fetchJson(pluginCfg, '/bridge/startup', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      channel: 'pi',
      project: detectProjectInfo(),
      include_guidance: true,
    }),
  });
}

async function fetchPromptRecallBridge(pluginCfg: any, prompt: string, sessionId: string | undefined) {
  if (!hasRecallConfig(pluginCfg)) return null;
  return fetchJson(pluginCfg, '/bridge/recall', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, prompt }),
  });
}

// ---- Prompt guidance ----

export const DEFAULT_GUIDANCE = [
  'Lore is the primary long-term memory system for this Pi agent.',
  'lore_boot is a fixed startup baseline inside Lore, not a separate config layer.',
  'At startup, Lore loads core://agent, core://soul, preferences://user, and core://agent/pi for Pi-specific runtime constraints.',
  'Use recall and search to add prompt-specific memory leads, not to replace the role of those fixed paths.',
  'Use lore_get_node to open relevant recalled nodes before relying on them.',
  'Use Lore tools to create, revise, delete, or move durable memory.',
  'Memory URI/path is a stable semantic identity, not a timestamp, log number, or one-off task title.',
  'Do not append dates, timestamps, or epoch values to ordinary memory paths; put dates in the content instead. Date paths are only for explicit diary/log/release/archive nodes.',
  'Before creating memory, search or open the likely owner node; prefer updating or merging into an existing stable node. Use create only for a new long-term semantic object.',
].join('\n');

export function loadPromptGuidance(): string {
  try {
    const content = readFileSync(new URL('./AGENT_RULES.md', import.meta.url), 'utf8').trim();
    return content || DEFAULT_GUIDANCE;
  } catch {
    return DEFAULT_GUIDANCE;
  }
}

// ---- Session ID helper ----

function getSessionId(ctx: any): string | undefined {
  const manager = ctx?.sessionManager;
  if (manager && typeof manager.getSessionId === 'function') return manager.getSessionId();
  return typeof manager?.sessionId === 'string' ? manager.sessionId : undefined;
}

// ---- Hook registration ----

export function registerHooks(pi: any, pluginCfg: any, _guidance: string) {
  pi.on('session_start', async (_event: any, ctx: any) => {
    if (!pluginCfg.startupHealthcheck) return;
    try {
      await fetchJson(pluginCfg, '/health', { method: 'GET' });
      ctx?.ui?.notify?.(`Lore connected: ${pluginCfg.baseUrl}`, 'info');
    } catch (error: any) {
      pi.logger?.warn?.(`lore: startup health check failed (${pluginCfg.baseUrl}): ${error.message}`);
    }
  });

  pi.on('before_agent_start', async (event: any, ctx: any) => {
    const sessionId = getSessionId(ctx);
    const out: any = {};

    if (pluginCfg.injectPromptGuidance) {
      try {
        const bridge = await fetchStartupBridge(pluginCfg, sessionId);
        const systemContext = typeof bridge?.system_context === 'string' ? bridge.system_context.trim() : '';
        if (systemContext) {
          out.systemPrompt = [event?.systemPrompt || '', systemContext]
            .filter(Boolean)
            .join('\n\n');
        }
      } catch (error: any) {
        pi.logger?.warn?.(`lore: bridge startup failed: ${error.message}`);
      }
    }

    if (typeof event?.prompt === 'string' && event.prompt.trim()) {
      try {
        const bridge = await fetchPromptRecallBridge(pluginCfg, event.prompt, sessionId);
        const context = typeof bridge?.context === 'string' ? bridge.context.trim() : '';
        if (context) {
          out.message = {
            customType: 'lore-recall',
            content: context,
            display: false,
            details: { source: 'lore', session_id: sessionId },
          };
        }
      } catch (error: any) {
        pi.logger?.warn?.(`lore: bridge recall failed: ${error.message}`);
      }
    }

    return Object.keys(out).length > 0 ? out : undefined;
  });
}

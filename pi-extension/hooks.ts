import { execSync } from 'node:child_process';
import { basename } from 'node:path';
import { fetchJson, hasRecallConfig } from './api';
import { createSkillsSession, type SkillsSession } from './skills';

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

export function detectProjectInfo(cwd?: string): ProjectInfo {
  // Agent sessions can run inside a long-lived host process whose own cwd is
  // unrelated to the session (for example a pi-web server). Prefer the session
  // cwd so project identity, repo grouping, and recall follow the session.
  const dir = typeof cwd === 'string' && cwd.trim() ? cwd : process.cwd();
  const dir_name = basename(dir);

  let repo_name: string | null = null;
  try {
    const gitOptions = { encoding: 'utf-8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'], cwd: dir } as const;
    const remote = execSync('git remote', gitOptions).trim().split('\n')[0];
    const remoteUrl = execSync(`git remote get-url ${remote}`, gitOptions).trim();
    const match = remoteUrl.match(/\/([^/.]+?)(?:\.git)?$/);
    if (match?.[1]) repo_name = match[1];
  } catch {}

  return { dir_name, repo_name };
}

// ---- Lifecycle helpers ----

async function fetchLifecycleEvent(pluginCfg: any, body: Record<string, unknown>) {
  return fetchJson(pluginCfg, '/lifecycle/event', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function fetchStartupLifecycle(pluginCfg: any, sessionId: string | undefined, cwd: string | undefined, skills: boolean) {
  return fetchLifecycleEvent(pluginCfg, {
    protocol_version: 'lore.lifecycle.v1',
    runtime: { runtime_id: 'pi', runtime_family: 'pi' },
    event: { name: 'session.start', native_name: 'session_start' },
    // Lore appends the Skills catalog only for clients that expose Skills tools.
    ...(skills ? { features: { skills: true } } : {}),
    normalized: { session_id: sessionId },
    project: detectProjectInfo(cwd),
  });
}

async function fetchPromptLifecycle(pluginCfg: any, prompt: string, sessionId: string | undefined, skills: boolean) {
  // Prompt lifecycle also carries explicit `$skill-name` invocations, so it must
  // remain available when Memory recall injection is disabled.
  return fetchLifecycleEvent(pluginCfg, {
    protocol_version: 'lore.lifecycle.v1',
    runtime: { runtime_id: 'pi', runtime_family: 'pi' },
    event: { name: 'prompt.submit', native_name: 'before_agent_start' },
    features: { memory_recall: hasRecallConfig(pluginCfg), ...(skills ? { skills: true } : {}) },
    normalized: { session_id: sessionId, prompt },
  });
}

function readReturnValue(response: any): any {
  return response?.host_output?.mode === 'return_value' && response.host_output.value
    ? response.host_output.value
    : null;
}

// ---- Session ID helper ----

function getSessionId(ctx: any): string | undefined {
  const manager = ctx?.sessionManager;
  if (!manager || typeof manager.getSessionId !== 'function') return undefined;
  const sessionId = manager.getSessionId();
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
}

// ---- Hook registration ----

export function registerHooks(pi: any, pluginCfg: any, skillsSession?: SkillsSession) {
  const startupRequests = new Map<string, Promise<void>>();
  // Boot baseline is per session, not per first turn: Pi rebuilds the system
  // prompt from its base on every user prompt, so the fixed baseline has to be
  // re-appended on each turn (and several sessions can run in one process).
  const startupAppendBySession = new Map<string, string>();
  const skills = skillsSession;

  pi.on('session_start', async (_event: any, ctx: any) => {
    if (pluginCfg.startupHealthcheck) {
      try {
        await fetchJson(pluginCfg, '/health', { method: 'GET' });
        ctx?.ui?.notify?.(`Lore connected: ${pluginCfg.baseUrl}`, 'info');
      } catch (error: any) {
        pi.logger?.warn?.(`lore: startup health check failed (${pluginCfg.baseUrl}): ${error.message}`);
      }
    }

    if (!pluginCfg.injectPromptGuidance) {
      // No automatic skill sync. Catalog identity is recorded only when lifecycle returns it.
      return;
    }
    const sessionId = getSessionId(ctx);
    if (!sessionId) return;

    const existing = startupRequests.get(sessionId);
    if (existing) return existing;

    const request = (async () => {
      try {
        const lifecycleResponse = await fetchStartupLifecycle(pluginCfg, sessionId, ctx?.cwd, Boolean(skills));
        // Record project/catalog identity only — never auto-download or reconcile skills.
        if (skills) {
          try {
            await skills.onSessionStart(lifecycleResponse);
          } catch (error: any) {
            pi.logger?.debug?.(`lore: skill catalog identity on session_start failed: ${error.message}`);
          }
        }
        const value = readReturnValue(lifecycleResponse);
        const systemPromptAppend = typeof value?.systemPromptAppend === 'string'
          ? value.systemPromptAppend.trim()
          : '';
        if (systemPromptAppend && startupRequests.get(sessionId) === request) {
          startupAppendBySession.set(sessionId, systemPromptAppend);
        }
      } catch (error: any) {
        pi.logger?.debug?.(`lore: lifecycle startup failed: ${error.message}`);
      } finally {
        if (startupRequests.get(sessionId) === request) startupRequests.delete(sessionId);
      }
    })();
    startupRequests.set(sessionId, request);
    return request;
  });

  pi.on('session_shutdown', async (_event: any, ctx: any) => {
    const sessionId = getSessionId(ctx);
    if (!sessionId) return;
    startupAppendBySession.delete(sessionId);
    startupRequests.delete(sessionId);
  });

  pi.on('before_agent_start', async (event: any, ctx: any) => {
    const sessionId = getSessionId(ctx);
    const out: any = {};

    if (sessionId) {
      // The first prompt can arrive before session_start finished fetching the
      // baseline; await it so the fixed boot context is never skipped.
      const pending = startupRequests.get(sessionId);
      if (pending) {
        try { await pending; } catch {}
      }
      const systemPromptAppend = startupAppendBySession.get(sessionId);
      if (systemPromptAppend) {
        out.systemPrompt = [event?.systemPrompt || '', systemPromptAppend]
          .filter(Boolean)
          .join('\n\n');
      }
    }

    if (typeof event?.prompt === 'string' && event.prompt.trim()) {
      try {
        const lifecycleResponse = await fetchPromptLifecycle(pluginCfg, event.prompt, sessionId, Boolean(skills));
        const message = readReturnValue(lifecycleResponse)?.message;
        if (message) out.message = message;
      } catch (error: any) {
        pi.logger?.debug?.(`lore: lifecycle recall failed: ${error.message}`);
      }
    }

    return Object.keys(out).length > 0 ? out : undefined;
  });

  return { skills };
}

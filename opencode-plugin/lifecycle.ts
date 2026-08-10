import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Hooks } from '@opencode-ai/plugin';
import type { Part } from '@opencode-ai/sdk';
import { LoreApiError, loreFetchJson } from './api.js';
import type { LorePluginConfig } from './config.js';
import {
  readSkillCatalog,
  skillDiscoveryBlockFromResponse,
  type SkillCatalog,
} from './skills.js';

export const LORE_RECALL_MARKER = 'lore:prompt-context';

export interface ClassifiedPrompt {
  sessionID: string;
  messageID: string;
  prompt: string;
  agent?: string;
  model?: string;
}

type ChatMessageHook = NonNullable<Hooks['chat.message']>;
export type ChatMessageInput = Parameters<ChatMessageHook>[0];
export type ChatMessageOutput = Parameters<ChatMessageHook>[1];

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validPartIdentity(part: Part, sessionID: string, messageID: string): boolean {
  return nonEmpty(part.id)
    && part.sessionID === sessionID
    && part.messageID === messageID;
}

function loreInjected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return record.lore_injected === true || record.marker === LORE_RECALL_MARKER;
}

export function classifyDirectUserPrompt(
  input: ChatMessageInput,
  output: ChatMessageOutput,
): ClassifiedPrompt | null {
  if (!nonEmpty(input.sessionID)) return null;
  if (!output || !output.message || output.message.role !== 'user') return null;
  const messageID = output.message.id;
  if (!nonEmpty(messageID)) return null;
  if (nonEmpty(input.messageID) && input.messageID !== messageID) return null;
  if (output.message.sessionID !== input.sessionID) return null;
  if (output.message.summary) return null;
  if (!Array.isArray(output.parts) || output.parts.length === 0) return null;

  const originalText: string[] = [];
  for (const part of output.parts) {
    if (!part || typeof part !== 'object' || !('type' in part)) return null;
    if (!validPartIdentity(part, input.sessionID, messageID)) return null;
    if (part.type === 'compaction' || part.type === 'subtask') return null;
    if (part.type !== 'text') {
      const supportedNonTextTypes = new Set([
        'reasoning', 'file', 'tool', 'step-start', 'step-finish', 'snapshot', 'patch', 'agent', 'retry',
      ]);
      if (!supportedNonTextTypes.has(part.type)) return null;
      continue;
    }
    if (part.synthetic === true || part.ignored === true || loreInjected(part.metadata)) continue;
    const value = part.text.trim();
    if (value) originalText.push(value);
  }

  if (originalText.length === 0) return null;
  const providerID = input.model?.providerID?.trim();
  const modelID = input.model?.modelID?.trim();

  return {
    sessionID: input.sessionID,
    messageID,
    prompt: originalText.join('\n\n'),
    ...(nonEmpty(input.agent) ? { agent: input.agent.trim() } : {}),
    ...(providerID && modelID ? { model: `${providerID}/${modelID}` } : {}),
  };
}

const SYSTEM_CONTEXT_START = '<!-- lore:opencode-system-context:start -->';
const SYSTEM_CONTEXT_END = '<!-- lore:opencode-system-context:end -->';
const STARTUP_RETRY_MS = 1_000;

interface HostOutputResponse {
  host_output?: {
    mode?: unknown;
    value?: {
      systemContext?: unknown;
      promptContext?: unknown;
    };
  };
  /** Skill lane is independent of memory host_output. */
  skill_catalog?: unknown;
  skill_candidates?: unknown;
}

interface SessionState {
  abortController: AbortController;
  startupPromise?: Promise<string | null>;
  systemContext?: string;
  retryAt: number;
  promptMessageIDs: Set<string>;
  skillCatalog?: SkillCatalog;
}

export interface OpenCodeLifecycleAdapter {
  hooks: Pick<Hooks, 'event' | 'chat.message' | 'experimental.chat.system.transform' | 'dispose'>;
  dispose(): Promise<void>;
}

function projectSnapshot(directory: string, worktree: string): {
  project: { dir_name: string; repo_name: string | null };
  native: { directory: string; worktree: string };
} {
  return {
    project: {
      dir_name: basename(directory) || directory,
      repo_name: basename(worktree) || null,
    },
    native: { directory, worktree },
  };
}

function hostValue(response: HostOutputResponse, key: 'systemContext' | 'promptContext'): string | null {
  if (response.host_output?.mode !== 'return_value') return null;
  const value = response.host_output.value?.[key];
  return nonEmpty(value) ? value : null;
}

function markedSystemContext(value: string): string {
  return `${SYSTEM_CONTEXT_START}\n${value}\n${SYSTEM_CONTEXT_END}`;
}

function isMarkedSystemContext(value: string): boolean {
  return value.includes(SYSTEM_CONTEXT_START) && value.includes(SYSTEM_CONTEXT_END);
}

function retryable(error: unknown): boolean {
  return !(error instanceof LoreApiError && error.status === 401);
}

export function createOpenCodeLifecycleAdapter(args: {
  config: LorePluginConfig;
  directory: string;
  worktree: string;
  logger?: Pick<Console, 'warn' | 'debug'>;
}): OpenCodeLifecycleAdapter {
  const { config, directory, worktree } = args;
  const logger = args.logger ?? console;
  const sessions = new Map<string, SessionState>();
  const project = projectSnapshot(directory, worktree);
  let warnedSystemCompatibility = false;
  let disposed = false;

  function warnSystemCompatibility(): void {
    if (warnedSystemCompatibility) return;
    warnedSystemCompatibility = true;
    logger.warn('Lore OpenCode system context is unavailable for this callback; native tools and prompt Recall remain enabled.');
  }

  function stateFor(sessionID: string): SessionState {
    const existing = sessions.get(sessionID);
    if (existing) return existing;
    const state: SessionState = {
      abortController: new AbortController(),
      retryAt: 0,
      promptMessageIDs: new Set(),
    };
    sessions.set(sessionID, state);
    return state;
  }

  function startupBody(sessionID: string) {
    return {
      protocol_version: 'lore.lifecycle.v1',
      runtime: { runtime_id: 'opencode', runtime_family: 'opencode' },
      event: { name: 'session.start', native_name: 'session.created' },
      normalized: { session_id: sessionID },
      project: project.project,
      native_input_snapshot: project.native,
    };
  }

  function promptBody(prompt: ClassifiedPrompt) {
    return {
      protocol_version: 'lore.lifecycle.v1',
      runtime: { runtime_id: 'opencode', runtime_family: 'opencode' },
      event: { name: 'prompt.submit', native_name: 'chat.message' },
      normalized: { session_id: prompt.sessionID, prompt: prompt.prompt },
      project: project.project,
      native_input_snapshot: {
        message_id: prompt.messageID,
        ...(prompt.agent ? { agent: prompt.agent } : {}),
        ...(prompt.model ? { model: prompt.model } : {}),
        ...project.native,
      },
    };
  }

  async function ensureStartup(sessionID: string): Promise<string | null> {
    if (disposed) return null;
    const state = stateFor(sessionID);
    if (state.systemContext) return state.systemContext;
    if (state.startupPromise) return state.startupPromise;
    if (Date.now() < state.retryAt) return null;

    const startupPromise = loreFetchJson<HostOutputResponse>(config, '/lifecycle/event', {
      method: 'POST',
      body: startupBody(sessionID),
      signal: state.abortController.signal,
      timeoutMs: config.startupTimeoutMs,
    })
      .then((response) => {
        const catalog = readSkillCatalog(response);
        if (catalog) state.skillCatalog = catalog;
        const systemContext = hostValue(response, 'systemContext');
        if (systemContext) state.systemContext = systemContext;
        return systemContext;
      })
      .catch((error: unknown) => {
        state.retryAt = retryable(error) ? Date.now() + STARTUP_RETRY_MS : Number.POSITIVE_INFINITY;
        logger.debug(`Lore OpenCode startup failed open: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      })
      .finally(() => {
        if (state.startupPromise === startupPromise) state.startupPromise = undefined;
      });
    state.startupPromise = startupPromise;
    return startupPromise;
  }

  const eventHook: NonNullable<Hooks['event']> = async ({ event }) => {
    if (event.type === 'session.created') {
      const sessionID = event.properties.info.id;
      if (nonEmpty(sessionID)) void ensureStartup(sessionID);
      return;
    }
    if (event.type === 'session.deleted') {
      const sessionID = event.properties.info.id;
      const state = sessions.get(sessionID);
      state?.abortController.abort();
      sessions.delete(sessionID);
      return;
    }
    if (event.type === 'session.compacted') {
      return;
    }
  };

  const systemHook: NonNullable<Hooks['experimental.chat.system.transform']> = async (input, output) => {
    if (!nonEmpty(input.sessionID) || !output || !Array.isArray(output.system)) {
      warnSystemCompatibility();
      return;
    }
    const systemContext = await ensureStartup(input.sessionID);
    if (!systemContext) return;
    const retained = output.system.filter((value) => !isMarkedSystemContext(value));
    retained.push(markedSystemContext(systemContext));
    output.system.splice(0, output.system.length, ...retained);
  };

  const messageHook: NonNullable<Hooks['chat.message']> = async (input, output) => {
    const prompt = classifyDirectUserPrompt(input, output);
    if (!prompt || disposed) return;
    const state = stateFor(prompt.sessionID);
    if (state.promptMessageIDs.has(prompt.messageID)) return;
    state.promptMessageIDs.add(prompt.messageID);

    try {
      const response = await loreFetchJson<HostOutputResponse>(config, '/lifecycle/event', {
        method: 'POST',
        body: promptBody(prompt),
        signal: state.abortController.signal,
        timeoutMs: config.requestTimeoutMs,
      });

      // Skill lane is independent of memory host_output; record catalog identity only.
      const catalog = readSkillCatalog(response);
      if (catalog) state.skillCatalog = catalog;

      // Discovery-only: never download or inject local paths.
      const skillBlock = skillDiscoveryBlockFromResponse(response);
      const promptContext = hostValue(response, 'promptContext');

      // Append discovery block to promptContext even when memory recall is absent.
      const combined = [promptContext, skillBlock].filter(nonEmpty).join('\n\n');
      if (!combined) return;

      output.parts.push({
        id: `prt_lore_${randomUUID().replaceAll('-', '')}`,
        sessionID: prompt.sessionID,
        messageID: prompt.messageID,
        type: 'text',
        text: combined,
        synthetic: true,
        metadata: { lore_injected: true, marker: LORE_RECALL_MARKER },
      });
    } catch (error) {
      if (retryable(error)) state.promptMessageIDs.delete(prompt.messageID);
      logger.debug(`Lore OpenCode prompt Recall failed open: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  async function dispose(): Promise<void> {
    disposed = true;
    for (const state of sessions.values()) state.abortController.abort();
    sessions.clear();
  }

  return {
    hooks: {
      event: eventHook,
      'chat.message': messageHook,
      'experimental.chat.system.transform': systemHook,
      dispose,
    },
    dispose,
  };
}

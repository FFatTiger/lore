import type { ProviderMessage, ProviderToolCall } from '../llm/provider';
import {
  getDreamPolicyWarnings,
  isDreamPolicyValidationBlocked,
} from './dreamToolPolicy';

interface DreamLoopEventCallback {
  (eventType: string, payload?: Record<string, unknown>): void | Promise<void>;
}

interface DreamLoopToolCallLogEntry {
  tool: string;
  args: Record<string, unknown>;
  result_preview: string;
  result_size_chars?: number;
  blocked?: boolean;
  success?: boolean;
}

interface ProcessDreamToolCallsOptions {
  turn: number;
  content: ProviderMessage['content'];
  rawToolCalls: ProviderToolCall[];
  messages: ProviderMessage[];
  toolCalls: DreamLoopToolCallLogEntry[];
  onEvent?: DreamLoopEventCallback;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

function parseDreamToolArgs(toolCall: ProviderToolCall): Record<string, unknown> {
  try {
    return JSON.parse(String(toolCall.function?.arguments || '{}')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toResultRecord(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null;
  return result as Record<string, unknown>;
}

function isProtectedBootBlocked(result: Record<string, unknown> | null): boolean {
  return Boolean(result?.blocked && result?.code === 'protected_boot_path');
}

const MAX_TOOL_RESULT_CHARS = 6000;
const MAX_TOOL_RESULT_PREVIEW_CHARS = 5200;

/**
 * Keeps a single oversized tool result from flooding the Dream context. The
 * agent can retry with a narrower limit, path, or query when it needs detail.
 */
function compactDreamToolResult(raw: string): string {
  if (raw.length <= MAX_TOOL_RESULT_CHARS) return raw;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    decoded = undefined;
  }
  const compacted: Record<string, unknown> = {
    truncated: true,
    original_chars: raw.length,
    preview: `${raw.slice(0, MAX_TOOL_RESULT_PREVIEW_CHARS)}…`,
    note: 'Dream tool result exceeded the per-call context budget; retry with a narrower limit/path/query if more detail is needed.',
  };
  if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
    compacted.top_level_keys = Object.keys(decoded as Record<string, unknown>).sort();
  } else if (Array.isArray(decoded)) {
    compacted.top_level_type = 'array';
    compacted.item_count = decoded.length;
  }
  return JSON.stringify(compacted);
}

function isBlockedToolResult(result: Record<string, unknown> | null): boolean {
  return Boolean(result && (result.blocked === true || result.error));
}

export async function processDreamToolCalls({
  turn,
  content,
  rawToolCalls,
  messages,
  toolCalls,
  onEvent,
  executeTool,
}: ProcessDreamToolCallsOptions): Promise<void> {
  messages.push({ role: 'assistant', content, tool_calls: rawToolCalls });

  for (const toolCall of rawToolCalls) {
    const name = String(toolCall.function?.name || '');
    const args = parseDreamToolArgs(toolCall);

    await onEvent?.('tool_call_started', { turn, tool: name, args });
    const result = await executeTool(name, args);
    const resultRecord = toResultRecord(result);
    const protectedBootBlocked = isProtectedBootBlocked(resultRecord);
    const policyValidationBlocked = isDreamPolicyValidationBlocked(resultRecord);
    const policyWarnings = getDreamPolicyWarnings(resultRecord);
    const blocked = protectedBootBlocked || policyValidationBlocked || isBlockedToolResult(resultRecord);

    if (protectedBootBlocked) {
      await onEvent?.('protected_node_blocked', {
        turn,
        tool: name,
        blocked_uri: resultRecord?.blocked_uri,
        boot_role: resultRecord?.boot_role,
        reason: resultRecord?.detail,
      });
    }

    if (policyValidationBlocked) {
      await onEvent?.('policy_validation_blocked', {
        turn,
        tool: name,
        reason: resultRecord?.detail,
        warnings: policyWarnings,
        policy_warnings: policyWarnings,
      });
    }

    if (policyWarnings.length > 0) {
      await onEvent?.('policy_warning_emitted', {
        turn,
        tool: name,
        warnings: policyWarnings,
        policy_warnings: policyWarnings,
      });
    }

    await onEvent?.('tool_call_finished', {
      turn,
      tool: name,
      ok: !blocked,
      blocked,
      protected_blocked: protectedBootBlocked,
      policy_blocked: policyValidationBlocked,
      warnings: policyWarnings,
      policy_warnings: policyWarnings,
    });

    const serializedResult = compactDreamToolResult(JSON.stringify(result));
    toolCalls.push({
      tool: name,
      args,
      result_preview: serializedResult.slice(0, 500),
      result_size_chars: serializedResult.length,
      blocked,
      success: !blocked && resultRecord?.success === true,
    });

    messages.push({
      role: 'tool',
      tool_call_id: String(toolCall.id || ''),
      content: serializedResult,
    });
  }
}

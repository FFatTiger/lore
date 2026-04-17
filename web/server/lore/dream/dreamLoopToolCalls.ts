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
}

interface ProcessDreamToolCallsOptions {
  turn: number;
  content: string;
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
    const blocked = protectedBootBlocked || policyValidationBlocked;

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

    toolCalls.push({
      tool: name,
      args,
      result_preview: JSON.stringify(result).slice(0, 500),
    });

    messages.push({
      role: 'tool',
      tool_call_id: String(toolCall.id || ''),
      content: JSON.stringify(result),
    });
  }
}

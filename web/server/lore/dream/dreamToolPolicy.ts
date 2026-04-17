import type { ClientType } from '../../auth';
import { buildContractError } from '../contracts';
import { parseUri } from '../core/utils';
import {
  validateCreatePolicy,
  validateDeletePolicy,
  validateUpdatePolicy,
} from '../ops/policy';

export interface DreamToolEventContext {
  source: string;
  session_id?: string | null;
  client_type?: ClientType | null;
}

interface DreamWritePolicyResult {
  blockedResult: Record<string, unknown> | null;
  warnings: string[];
}

function toFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function buildPolicyBlockedResult(errors: string[], warnings: string[]): Record<string, unknown> {
  const detail = errors.join('; ');
  const error = Object.assign(new Error(detail), { status: 422, code: 'validation_error' });
  const envelope = buildContractError(error, detail, warnings);
  return {
    error: envelope.detail,
    ...envelope,
    status: 422,
  };
}

export function getDreamPolicyWarnings(result: Record<string, unknown> | null): string[] {
  if (!result) return [];
  const warnings = normalizeWarnings(result.warnings);
  if (warnings.length > 0) return warnings;
  return normalizeWarnings(result.policy_warnings);
}

export function isDreamPolicyValidationBlocked(result: Record<string, unknown> | null): boolean {
  return Boolean(result && result.code === 'validation_error' && Number(result.status || 0) === 422);
}

export async function applyDreamWritePolicy(
  name: string,
  args: Record<string, unknown>,
  eventContext: DreamToolEventContext,
): Promise<DreamWritePolicyResult> {
  switch (name) {
    case 'create_node': {
      const policyResult = await validateCreatePolicy({
        priority: toFiniteNumber(args.priority) ?? 2,
        disclosure: typeof args.disclosure === 'string' ? args.disclosure : null,
      });
      return policyResult.errors.length > 0
        ? { blockedResult: buildPolicyBlockedResult(policyResult.errors, policyResult.warnings), warnings: [] }
        : { blockedResult: null, warnings: policyResult.warnings };
    }
    case 'update_node': {
      const { domain, path } = parseUri(String(args.uri || ''));
      const policyResult = await validateUpdatePolicy({
        domain,
        path,
        priority: toFiniteNumber(args.priority),
        disclosure: typeof args.disclosure === 'string' ? args.disclosure : undefined,
        sessionId: eventContext.session_id ?? null,
      });
      return policyResult.errors.length > 0
        ? { blockedResult: buildPolicyBlockedResult(policyResult.errors, policyResult.warnings), warnings: [] }
        : { blockedResult: null, warnings: policyResult.warnings };
    }
    case 'delete_node': {
      const { domain, path } = parseUri(String(args.uri || ''));
      const policyResult = await validateDeletePolicy({
        domain,
        path,
        sessionId: eventContext.session_id ?? null,
      });
      return policyResult.errors.length > 0
        ? { blockedResult: buildPolicyBlockedResult(policyResult.errors, policyResult.warnings), warnings: [] }
        : { blockedResult: null, warnings: policyResult.warnings };
    }
    default:
      return { blockedResult: null, warnings: [] };
  }
}

import {
  describeProtectedBootOperation,
  inspectProtectedBootOperation,
  type ProtectedBootInspection,
} from '../core/protectedBoot';

export interface DreamProtectedBootOperation extends ProtectedBootInspection {
  reason?: string;
}

export function getProtectedBootOperation(
  name: string,
  args: Record<string, unknown>,
): DreamProtectedBootOperation | null {
  const inspection = inspectProtectedBootOperation(name, args);
  if (!inspection) return null;
  return {
    ...inspection,
    reason: describeProtectedBootOperation(inspection, 'dream:auto'),
  };
}

export function buildProtectedBootBlockedResult(op: DreamProtectedBootOperation) {
  return {
    error: op.reason,
    detail: op.reason,
    code: 'protected_boot_path',
    status: 409,
    blocked: true,
    operation: op.operation,
    blocked_uri: op.blocked_uri,
    boot_role: op.spec.role,
    boot_role_label: op.spec.role_label,
    dream_protection: op.spec.dream_protection,
    requested_old_uri: op.requested_old_uri,
    requested_new_uri: op.requested_new_uri,
  };
}

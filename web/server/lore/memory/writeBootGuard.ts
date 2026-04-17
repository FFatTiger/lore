import {
  inspectProtectedBootOperation,
  type ProtectedBootInspection,
} from '../core/protectedBoot';

export interface WriteProtectionContext {
  source?: string;
}

function isRollbackContext(eventContext: WriteProtectionContext): boolean {
  return eventContext.source === 'dream:rollback';
}

function throwProtectedBootError(message: string, inspection: ProtectedBootInspection): never {
  const error = Object.assign(new Error(message), {
    status: 409,
    code: 'protected_boot_path',
    blocked_uri: inspection.blocked_uri,
    boot_role: inspection.spec.role,
    boot_role_label: inspection.spec.role_label,
  });
  throw error;
}

export function assertDeleteAllowed(
  domain: string,
  path: string,
  eventContext: WriteProtectionContext,
): void {
  if (isRollbackContext(eventContext)) return;
  const inspection = inspectProtectedBootOperation('delete_node', { uri: `${domain}://${path}` });
  if (!inspection) return;
  throwProtectedBootError(
    `Cannot delete fixed boot node ${inspection.spec.uri} (${inspection.spec.role_label}). Fixed boot paths cannot be deleted.`,
    inspection,
  );
}

export function assertMoveAllowed(
  oldUri: string,
  newUri: string,
  eventContext: WriteProtectionContext,
): void {
  if (isRollbackContext(eventContext)) return;

  const inspection = inspectProtectedBootOperation('move_node', {
    old_uri: oldUri,
    new_uri: newUri,
  });
  if (!inspection) return;

  if (inspection.match === 'new_uri') {
    throwProtectedBootError(
      `Cannot move a node onto fixed boot path ${inspection.spec.uri} (${inspection.spec.role_label}). Fixed boot paths are reserved.`,
      inspection,
    );
  }

  throwProtectedBootError(
    `Cannot move fixed boot node ${inspection.spec.uri} (${inspection.spec.role_label}). Fixed boot paths cannot be moved.`,
    inspection,
  );
}

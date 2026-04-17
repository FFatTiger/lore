import { getBootNodeSpec, type BootNodeSpec } from '../memory/boot';

export interface ProtectedBootInspection {
  operation: 'update_node' | 'delete_node' | 'move_node';
  match: 'uri' | 'old_uri' | 'new_uri';
  blocked_uri: string;
  requested_old_uri?: string;
  requested_new_uri?: string;
  spec: BootNodeSpec;
}

export function inspectProtectedBootOperation(
  name: string,
  args: Record<string, unknown>,
): ProtectedBootInspection | null {
  if (name === 'update_node' || name === 'delete_node') {
    const spec = getBootNodeSpec(args.uri);
    if (!spec) return null;
    return {
      operation: name,
      match: 'uri',
      blocked_uri: spec.uri,
      spec,
    };
  }

  if (name === 'move_node') {
    const oldSpec = getBootNodeSpec(args.old_uri);
    if (oldSpec) {
      return {
        operation: 'move_node',
        match: 'old_uri',
        blocked_uri: oldSpec.uri,
        requested_old_uri: String(args.old_uri || ''),
        requested_new_uri: String(args.new_uri || ''),
        spec: oldSpec,
      };
    }

    const newSpec = getBootNodeSpec(args.new_uri);
    if (!newSpec) return null;
    return {
      operation: 'move_node',
      match: 'new_uri',
      blocked_uri: newSpec.uri,
      requested_old_uri: String(args.old_uri || ''),
      requested_new_uri: String(args.new_uri || ''),
      spec: newSpec,
    };
  }

  return null;
}

export function describeProtectedBootOperation(op: ProtectedBootInspection, actor = 'system'): string {
  const role = op.spec.role_label;
  switch (op.operation) {
    case 'update_node':
      return `${actor} cannot update protected boot node ${op.blocked_uri} (${role})`;
    case 'delete_node':
      return `${actor} cannot delete protected boot node ${op.blocked_uri} (${role})`;
    case 'move_node':
      if (op.match === 'new_uri') {
        return `${actor} cannot move a node onto protected boot path ${op.blocked_uri} (${role})`;
      }
      return `${actor} cannot move protected boot node ${op.blocked_uri} (${role})`;
  }
}

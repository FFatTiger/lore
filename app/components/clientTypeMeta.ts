export type ClientTone = 'blue' | 'purple' | 'teal' | 'orange' | 'soft';

interface ClientTypeMeta {
  label: string;
  tone: ClientTone;
  assetPath: string | null;
  initials: string;
}

const CLIENT_TYPE_META: Record<string, ClientTypeMeta> = {
  claudecode: {
    label: 'Claude Code',
    tone: 'blue',
    assetPath: '/channel-icons/claudecode.svg',
    initials: 'CC',
  },
  openclaw: {
    label: 'OpenClaw',
    tone: 'purple',
    assetPath: '/channel-icons/openclaw.svg',
    initials: 'OC',
  },
  hermes: {
    label: 'Hermes',
    tone: 'teal',
    assetPath: '/channel-icons/hermes.svg',
    initials: 'H',
  },
  mcp: {
    label: 'MCP',
    tone: 'orange',
    assetPath: '/channel-icons/mcp.svg',
    initials: 'M',
  },
};

export const KNOWN_CLIENT_TYPES = Object.keys(CLIENT_TYPE_META);

function normalizeClientTypeKey(clientType: unknown): string {
  return String(clientType || '').trim().toLowerCase();
}

export function clientTypeTone(clientType: unknown): ClientTone {
  return CLIENT_TYPE_META[normalizeClientTypeKey(clientType)]?.tone || 'soft';
}

export function clientTypeLabel(clientType: unknown): string {
  return CLIENT_TYPE_META[normalizeClientTypeKey(clientType)]?.label || 'Legacy';
}

export function clientTypeAssetPath(clientType: unknown): string | null {
  return CLIENT_TYPE_META[normalizeClientTypeKey(clientType)]?.assetPath || null;
}

export function clientTypeInitials(clientType: unknown): string {
  return CLIENT_TYPE_META[normalizeClientTypeKey(clientType)]?.initials || 'L';
}

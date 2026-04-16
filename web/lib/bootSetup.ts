export const BOOT_STATUS_CHANGED_EVENT = 'lore:boot-status-changed';

export type BootNodeRole = 'agent' | 'soul' | 'user';
export type BootNodeState = 'missing' | 'empty' | 'initialized';
export type BootOverallState = 'uninitialized' | 'partial' | 'complete';
export type BootSaveStatus = 'created' | 'updated' | 'unchanged' | 'failed';
export type BootDraftStatus = 'generated' | 'failed';

export interface BootMemory {
  uri: string;
  content: string;
  priority: number;
  disclosure: string | null;
  node_uuid: string;
  boot_role?: BootNodeRole;
  boot_role_label?: string;
  boot_purpose?: string;
}

export interface BootRecentMemory {
  uri: string;
  priority: number;
  disclosure: string | null;
  created_at: string | null;
}

export interface BootStatusNode {
  uri: string;
  role: BootNodeRole;
  role_label: string;
  purpose: string;
  dream_protection: 'protected';
  state: BootNodeState;
  content: string;
  content_length: number;
  priority: number | null;
  disclosure: string | null;
  node_uuid: string | null;
}

export interface BootViewData {
  loaded: number;
  total: number;
  failed: string[];
  core_memories: BootMemory[];
  recent_memories: BootRecentMemory[];
  nodes: BootStatusNode[];
  overall_state: BootOverallState;
  remaining_count: number;
  draft_generation_available: boolean;
  draft_generation_reason: string | null;
}

export interface SaveBootNodeResult {
  uri: string;
  status: BootSaveStatus;
  node_uuid: string | null;
  detail: string | null;
}

export interface SaveBootNodesResponse {
  results: SaveBootNodeResult[];
}

export interface BootDraftResult {
  uri: string;
  status: BootDraftStatus;
  content: string | null;
  detail: string | null;
}

export interface GenerateBootDraftsResponse {
  model: string;
  results: BootDraftResult[];
}

export function isSetupPath(pathname: string | null | undefined): boolean {
  const value = String(pathname || '');
  return value === '/setup' || value.startsWith('/setup/');
}

export function isSettingsPath(pathname: string | null | undefined): boolean {
  const value = String(pathname || '');
  return value === '/settings' || value.startsWith('/settings/');
}

export function getBootSetupRedirect(
  pathname: string | null | undefined,
  overallState: BootOverallState | null | undefined,
): string | null {
  if (!overallState) return null;

  if (overallState !== 'complete') {
    if (isSetupPath(pathname) || isSettingsPath(pathname)) return null;
    return '/setup';
  }

  if (isSetupPath(pathname) || pathname === '/') return '/memory';
  return null;
}

export function dispatchBootStatusChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BOOT_STATUS_CHANGED_EVENT));
}

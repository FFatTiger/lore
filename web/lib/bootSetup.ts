export const SETUP_STATUS_CHANGED_EVENT = 'lore:setup-status-changed';
export const BOOT_STATUS_CHANGED_EVENT = SETUP_STATUS_CHANGED_EVENT;

export type BootNodeRole = 'agent' | 'soul' | 'user';
export type BootNodeState = 'missing' | 'empty' | 'initialized';
export type BootOverallState = 'uninitialized' | 'partial' | 'complete';
export type BootNodeScope = 'global' | 'client';
export type BootClientType = 'claudecode' | 'openclaw' | 'hermes' | 'codex';
export type BootSaveStatus = 'created' | 'updated' | 'unchanged' | 'failed';
export type BootDraftStatus = 'generated' | 'failed';
export type SetupStepId = string;

const STATIC_SETUP_STEP_PATHS = {
  embedding: '/setup/embedding',
  llm: '/setup/llm',
} as const;

export interface BootMemory {
  id?: string;
  uri: string;
  content: string;
  priority: number;
  disclosure: string | null;
  node_uuid: string;
  role?: BootNodeRole;
  boot_role?: BootNodeRole;
  boot_role_label?: string;
  boot_purpose?: string;
  purpose?: string;
  scope?: BootNodeScope;
  client_type?: BootClientType | null;
  setup_slug?: string;
  setup_title?: string;
  setup_description?: string;
}

export interface BootRecentMemory {
  uri: string;
  priority: number;
  disclosure: string | null;
  created_at: string | null;
}

export interface BootStatusNode {
  id: string;
  uri: string;
  role: BootNodeRole;
  role_label: string;
  purpose: string;
  dream_protection: 'protected';
  scope: BootNodeScope;
  client_type: BootClientType | null;
  setup_slug: string;
  setup_title: string;
  setup_description: string;
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
  selected_client_type: string | null;
  includes_all_clients: boolean;
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

export interface BootSetupDecision {
  kind: 'none' | 'prompt' | 'redirect';
  target: string | null;
}

export interface SetupRuntimeStatus {
  configured: boolean;
  runtime_ready: boolean;
}

export interface SetupFlowStep {
  id: SetupStepId;
  path: string;
  label: string;
  description?: string;
  complete: boolean;
  role?: BootNodeRole;
  uri?: string;
  scope?: BootNodeScope;
  client_type?: BootClientType | null;
  setup_slug?: string;
}

export interface SetupFlowStatus {
  complete: boolean;
  next_step: string | null;
  steps: SetupFlowStep[];
  embedding: SetupRuntimeStatus;
  llm: SetupRuntimeStatus;
  boot: {
    overall_state: BootOverallState;
    nodes: BootStatusNode[];
    loaded: number;
    total: number;
    remaining_count: number;
    draft_generation_available: boolean;
    draft_generation_reason: string | null;
    includes_all_clients: boolean;
  };
}

export function makeBootSetupStepId(setupSlug: string): SetupStepId {
  return `boot:${String(setupSlug || '').trim()}`;
}

export function extractBootSetupSlug(stepId: string): string | null {
  const value = String(stepId || '').trim();
  return value.startsWith('boot:') ? value.slice('boot:'.length) : null;
}

export function isBootSetupStepId(stepId: string): boolean {
  return extractBootSetupSlug(stepId) !== null;
}

export function getSetupStepPath(stepId: SetupStepId): string {
  if (stepId in STATIC_SETUP_STEP_PATHS) {
    return STATIC_SETUP_STEP_PATHS[stepId as keyof typeof STATIC_SETUP_STEP_PATHS];
  }

  const bootSlug = extractBootSetupSlug(stepId);
  if (bootSlug) return `/setup/boot/${bootSlug}`;
  return '/setup';
}

export function isSetupPath(pathname: string | null | undefined): boolean {
  const value = String(pathname || '');
  return value === '/setup' || value.startsWith('/setup/');
}

export function isSettingsPath(pathname: string | null | undefined): boolean {
  const value = String(pathname || '');
  return value === '/settings' || value.startsWith('/settings/');
}

export function getSetupFlowDecision(
  pathname: string | null | undefined,
  setupStatus: SetupFlowStatus | null | undefined,
  hasAcknowledgedPrompt = false,
): BootSetupDecision {
  if (!setupStatus) return { kind: 'none', target: null };

  if (!setupStatus.complete) {
    if (isSetupPath(pathname) || isSettingsPath(pathname)) {
      return { kind: 'none', target: null };
    }
    const target = setupStatus.next_step || getSetupStepPath('embedding');
    if (!hasAcknowledgedPrompt) {
      return { kind: 'prompt', target };
    }
    return { kind: 'redirect', target };
  }

  if (isSetupPath(pathname) || pathname === '/') {
    return { kind: 'redirect', target: '/memory' };
  }

  return { kind: 'none', target: null };
}

export function getSetupFlowRedirect(
  pathname: string | null | undefined,
  setupStatus: SetupFlowStatus | null | undefined,
): string | null {
  const decision = getSetupFlowDecision(pathname, setupStatus, true);
  return decision.kind === 'redirect' ? decision.target : null;
}

export function getBootSetupDecision(
  pathname: string | null | undefined,
  overallState: BootOverallState | null | undefined,
  hasAcknowledgedPrompt = false,
): BootSetupDecision {
  if (!overallState) return { kind: 'none', target: null };

  if (overallState !== 'complete') {
    if (isSetupPath(pathname) || isSettingsPath(pathname)) {
      return { kind: 'none', target: null };
    }
    if (!hasAcknowledgedPrompt) {
      return { kind: 'prompt', target: '/setup' };
    }
    return { kind: 'redirect', target: '/setup' };
  }

  if (isSetupPath(pathname) || pathname === '/') {
    return { kind: 'redirect', target: '/memory' };
  }

  return { kind: 'none', target: null };
}

export function getBootSetupRedirect(
  pathname: string | null | undefined,
  overallState: BootOverallState | null | undefined,
): string | null {
  const decision = getBootSetupDecision(pathname, overallState, true);
  return decision.kind === 'redirect' ? decision.target : null;
}

export function dispatchSetupStatusChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SETUP_STATUS_CHANGED_EVENT));
}

export function dispatchBootStatusChanged(): void {
  dispatchSetupStatusChanged();
}

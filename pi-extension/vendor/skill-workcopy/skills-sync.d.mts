/**
 * Host-shared Lore skills sync (see skills-sync.mjs). Reconciles a host-native
 * skills directory with the server catalog and records the outcome in
 * <root>/.lore-sync-status.json. Never throws: failures land in errors.
 */

export interface SkillsSyncStatus {
  finished_at: string;
  project_id: string;
  catalog_revision: string;
  created: string[];
  updated: string[];
  unchanged: string[];
  removed: string[];
  conflicts: string[];
  errors: Array<{ name: string; message: string }>;
}

export function runSkillsSync(opts: {
  clientType: string;
  /** Host-native skills directory to reconcile. */
  root?: string;
  /**
   * Resolves the skills directory from the project_id returned by the catalog,
   * for hosts keyed by server project identity (~/.lore/skills/<project_id>).
   * Used when root is omitted.
   */
  rootForProject?: (projectId: string) => string;
  loreHome?: string;
  baseUrl?: string;
  apiToken?: string;
  timeoutMs?: number;
}): Promise<SkillsSyncStatus>;

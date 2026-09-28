/**
 * Prompt-time skill candidate discovery helpers (no download / no local path).
 * Read-only mirror materialization lives in vendor/skill-workcopy.
 */

import {
  skillIdOf,
  skillVersionOf,
  normalizeSkillCandidate,
  type SkillCandidate,
} from './vendor/skill-workcopy/index.mjs';

export interface SkillCatalog {
  project_id: string;
  catalog_revision: string;
}

export function readSkillCatalog(lifecycleResponse: unknown): SkillCatalog | null {
  if (!lifecycleResponse || typeof lifecycleResponse !== 'object') return null;
  const catalog = (lifecycleResponse as Record<string, unknown>).skill_catalog;
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return null;
  const project_id = String((catalog as Record<string, unknown>).project_id || '').trim();
  if (!project_id) return null;
  return {
    project_id,
    catalog_revision: String((catalog as Record<string, unknown>).catalog_revision || ''),
  };
}

export function readSkillCandidates(lifecycleResponse: unknown): SkillCandidate[] {
  if (!lifecycleResponse || typeof lifecycleResponse !== 'object') return [];
  const raw = (lifecycleResponse as Record<string, unknown>).skill_candidates;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map(normalizeSkillCandidate);
}

export function discoveryCandidateEntries(candidates: SkillCandidate[]): Array<{
  skill_id: string;
  name: string;
  version?: string | number;
  description?: string;
}> {
  const out: Array<{
    skill_id: string;
    name: string;
    version?: string | number;
    description?: string;
  }> = [];
  for (const candidate of candidates || []) {
    const name = String(candidate.name || '').trim();
    const skillId = skillIdOf(candidate);
    if (!name || !skillId) continue;
    out.push({
      skill_id: skillId,
      name,
      version: skillVersionOf(candidate),
      description: typeof candidate.description === 'string' ? candidate.description : undefined,
    });
  }
  return out;
}

/**
 * Discovery-only block: skill identities for the model. Never includes local paths
 * or downloads content. Call lore_skill_get with skill_id to materialize.
 */
export function formatSkillCandidateBlock(candidates: Array<{
  skill_id: string;
  name: string;
  version?: string | number;
  description?: string;
}>): string {
  if (!candidates.length) return '';
  const lines = ['<lore-skills>'];
  lines.push('Matched Lore skills. Call lore_skill_get with skill_id to fetch a local copy; managed package files are read-only, and the skill directory stays writable for local outputs.');
  for (const c of candidates) {
    const version = c.version === undefined || c.version === '' ? '' : ` v${c.version}`;
    const desc = c.description ? ` — ${String(c.description).replace(/\s+/g, ' ').trim()}` : '';
    lines.push(`- ${c.name}${version}${desc}`);
    lines.push(`  skill_id: ${c.skill_id}`);
    if (c.version !== undefined && c.version !== '') {
      lines.push(`  version: ${c.version}`);
    }
  }
  lines.push('</lore-skills>');
  return lines.join('\n');
}

export function skillDiscoveryBlockFromResponse(lifecycleResponse: unknown): string {
  const candidates = discoveryCandidateEntries(readSkillCandidates(lifecycleResponse));
  return formatSkillCandidateBlock(candidates);
}

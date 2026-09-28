/**
 * Prompt-time skill candidate discovery helpers (no download / no local path).
 * Used by local MCP tests and mirrored in Codex/Claude UserPromptSubmit hooks.
 */

export function skillIdOf(value) {
  return String(value?.skill_id || value?.id || '').trim();
}

export function skillVersionOf(value) {
  if (value?.version !== undefined && value?.version !== null && value?.version !== '') {
    return value.version;
  }
  return value?.expected_version;
}

export function discoveryCandidateEntries(candidates) {
  const out = [];
  for (const candidate of candidates || []) {
    const name = String(candidate?.name || '').trim();
    const skillId = skillIdOf(candidate);
    if (!name || !skillId) continue;
    out.push({
      skill_id: skillId,
      name,
      version: skillVersionOf(candidate),
      description: typeof candidate?.description === 'string' ? candidate.description : undefined,
    });
  }
  return out;
}

export function formatSkillCandidateBlock(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const lines = ['<lore-skills>'];
  lines.push('Matched Lore skills. Call lore_skill_get with skill_id to fetch a local copy; managed package files are read-only, and the skill directory stays writable for local outputs.');
  for (const c of candidates) {
    const skillId = skillIdOf(c);
    const name = String(c?.name || '').trim();
    if (!skillId || !name) continue;
    const versionRaw = skillVersionOf(c);
    const version = versionRaw === undefined || versionRaw === null || versionRaw === '' ? '' : ` v${versionRaw}`;
    const desc = typeof c?.description === 'string' && c.description.trim()
      ? ` — ${c.description.replace(/\s+/g, ' ').trim()}`
      : '';
    lines.push(`- ${name}${version}${desc}`);
    lines.push(`  skill_id: ${skillId}`);
    if (versionRaw !== undefined && versionRaw !== null && versionRaw !== '') {
      lines.push(`  version: ${versionRaw}`);
    }
  }
  lines.push('</lore-skills>');
  return lines.length > 3 ? lines.join('\n') : '';
}

export function readSkillCandidates(lifecycleResponse) {
  const raw = lifecycleResponse?.skill_candidates;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object');
}

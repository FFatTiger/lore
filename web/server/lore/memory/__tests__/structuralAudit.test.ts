import { describe, it, expect } from 'vitest';
import { buildStructuralAudit, type StructuralPathRow } from '../structuralAudit';

function row(domain: string, path: string, content = 'body', nodeUuid = `${domain}:${path}`): StructuralPathRow {
  return { domain, path, content, node_uuid: nodeUuid, created_at: '2026-05-07T00:00:00.000Z' };
}

describe('buildStructuralAudit', () => {
  it('returns compact counts when no category is given', () => {
    const summary = buildStructuralAudit([
      row('project', 'lore/dream_review_2026_05_07', 'reviewed on 2026-05-07'),
      row('core', 'projects/legacy_plan'),
      row('core://agent', 'broken'),
      row('project', 'lore/empty', ''),
    ]);
    expect(summary.counts).toEqual({
      date_suffix: 1,
      core_projects: 1,
      malformed_domains: 1,
      empty_content: 1,
    });
    expect(summary.total).toBe(4);
    expect(summary.date_suffix_paths).toBeUndefined();
  });

  it('pages date-suffix candidates with the proposed stable URI', () => {
    const summary = buildStructuralAudit([
      row('project', 'lore', 'project home'),
      row('project', 'lore/dream_review_2026_05_07', 'reviewed on 2026-05-07'),
      row('project', 'lore/dream_review_2026_05_08'),
      row('project', 'lore/dream_review'),
    ], { category: 'date_suffix', limit: 1, offset: 0 });

    expect(summary.total).toBe(2);
    expect(summary.has_more).toBe(true);
    expect(summary.date_suffix_paths).toHaveLength(1);
    expect(summary.date_suffix_paths?.[0]).toMatchObject({
      uri: 'project://lore/dream_review_2026_05_07',
      category: 'date_suffix',
      reason: 'ordinary_date_suffix',
      parsed_date: '2026-05-07',
      proposed_stable_uri: 'project://lore/dream_review',
      target_exists: true,
      target_parent_exists: true,
      content_contains_date: true,
    });

    const secondPage = buildStructuralAudit([
      row('project', 'lore/dream_review_2026_05_07'),
      row('project', 'lore/dream_review_2026_05_08'),
    ], { category: 'date_suffix', limit: 1, offset: 1 });
    expect(secondPage.has_more).toBe(false);
    expect(secondPage.date_suffix_paths?.[0].uri).toBe('project://lore/dream_review_2026_05_08');
  });

  it('excludes explicit archive concepts from date-suffix candidates', () => {
    const summary = buildStructuralAudit([
      row('project', 'archive/release_2026_05_07'),
    ], { category: 'date_suffix' });
    expect(summary.counts.date_suffix).toBe(0);
    expect(summary.date_suffix_paths).toEqual([]);
  });

  it('reports project concepts misplaced under core', () => {
    const summary = buildStructuralAudit([
      row('core', 'projects/checkout'),
      row('core', 'projects'),
      row('core', 'agent'),
    ], { category: 'core_projects' });
    expect(summary.counts.core_projects).toBe(2);
    expect(summary.core_projects_paths?.map((item) => item.uri)).toEqual([
      'core://projects/checkout',
      'core://projects',
    ]);
  });

  it('reports malformed domains and empty content separately', () => {
    const malformed = buildStructuralAudit([row('core://agent', 'x')], { category: 'malformed_domains' });
    expect(malformed.malformed_domains?.[0].reason).toBe('domain_contains_uri_scheme: core://agent');

    const empty = buildStructuralAudit([row('project', 'lore/empty', '   ')], { category: 'empty_content' });
    expect(empty.empty_content_nodes?.[0]).toMatchObject({
      uri: 'project://lore/empty',
      reason: 'no_active_memory_content',
    });
  });
});

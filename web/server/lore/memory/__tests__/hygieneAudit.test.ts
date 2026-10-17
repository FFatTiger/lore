import { describe, it, expect } from 'vitest';
import {
  buildHygieneAudit,
  GLOSSARY_BLOAT_KEYWORDS,
  OVERSIZED_CONTENT_CHARS,
  type HygieneAuditIndex,
} from '../hygieneAudit';
import type { StructuralPathRow } from '../structuralAudit';

function pathRow(domain: string, path: string, content = 'body', nodeUuid = `${domain}:${path}`): StructuralPathRow {
  return { domain, path, content, node_uuid: nodeUuid, created_at: null };
}

function indexWith({
  paths = [],
  childCounts = {},
  glossary = {},
}: {
  paths?: StructuralPathRow[];
  childCounts?: Record<string, number>;
  glossary?: Record<string, string[]>;
} = {}): HygieneAuditIndex {
  const index: HygieneAuditIndex = {
    paths,
    uuidToUri: new Map(),
    childCounts: new Map(Object.entries(childCounts)),
    keywordsByUuid: new Map(),
    uuidsByKeyword: new Map(),
  };
  for (const row of paths) {
    if (!index.uuidToUri.has(row.node_uuid)) index.uuidToUri.set(row.node_uuid, `${row.domain}://${row.path}`);
  }
  for (const [uuid, keywords] of Object.entries(glossary)) {
    index.keywordsByUuid.set(uuid, keywords);
    for (const keyword of keywords) {
      const uuids = index.uuidsByKeyword.get(keyword) || [];
      uuids.push(uuid);
      index.uuidsByKeyword.set(keyword, uuids);
    }
  }
  return index;
}

describe('buildHygieneAudit', () => {
  it('returns counts only when no category is given', () => {
    const index = indexWith({ paths: [pathRow('work', 'notes')] });
    const summary = buildHygieneAudit(index);
    expect(summary.items).toBeUndefined();
    expect(summary.counts).toEqual({
      oversized: 0,
      glossary_bloat: 0,
      identifier_keywords: 0,
      shared_keywords: 0,
      placeholder_parents: 0,
      legacy_domains: 1,
    });
    expect(summary.total).toBe(1);
  });

  it('flags content longer than the oversized threshold', () => {
    const index = indexWith({
      paths: [
        pathRow('project', 'lore/long', 'x'.repeat(OVERSIZED_CONTENT_CHARS + 1)),
        pathRow('project', 'lore/ok', 'x'.repeat(OVERSIZED_CONTENT_CHARS)),
      ],
    });
    const summary = buildHygieneAudit(index, { category: 'oversized' });
    expect(summary.items).toEqual([{
      uri: 'project://lore/long',
      category: 'oversized',
      reason: 'content_over_4000_chars',
      chars: OVERSIZED_CONTENT_CHARS + 1,
    }]);
  });

  it('flags glossaries with more than the bloat threshold', () => {
    const keywords = Array.from({ length: GLOSSARY_BLOAT_KEYWORDS + 1 }, (_, i) => `kw${i}`);
    const index = indexWith({
      paths: [pathRow('project', 'lore/bloated', 'body', 'u1')],
      glossary: { u1: keywords },
    });
    const summary = buildHygieneAudit(index, { category: 'glossary_bloat' });
    expect(summary.items?.[0]).toMatchObject({
      uri: 'project://lore/bloated',
      keyword_count: GLOSSARY_BLOAT_KEYWORDS + 1,
      reason: 'glossary_over_30_keywords',
    });
  });

  it('reports identifier keywords as diagnostics only', () => {
    const index = indexWith({
      paths: [pathRow('project', 'lore/deploy', 'body', 'u1')],
      glossary: { u1: ['deploy', 'v1.3.7', 'api.huu.im:30147', 'BM25'] },
    });
    const summary = buildHygieneAudit(index, { category: 'identifier_keywords' });
    expect(summary.items?.[0].keywords).toEqual(['v1.3.7', 'api.huu.im:30147', 'BM25']);
    expect(summary.counts.identifier_keywords).toBe(1);
  });

  it('groups keywords shared by at least eight nodes with their common parent', () => {
    const paths = Array.from({ length: 8 }, (_, i) => pathRow('project', `lore/topic_${i}`, 'body', `u${i}`));
    const index = indexWith({
      paths,
      glossary: Object.fromEntries(paths.map((row) => [row.node_uuid, ['lore', 'common']])),
    });
    const summary = buildHygieneAudit(index, { category: 'shared_keywords' });
    expect(summary.items).toHaveLength(2);
    expect(summary.items?.[0]).toMatchObject({
      keyword: 'common',
      node_count: 8,
      common_parent: 'project://lore',
    });
    expect(summary.items?.[0].nodes).toHaveLength(8);
  });

  it('flags thin parents that have children', () => {
    const index = indexWith({
      paths: [
        pathRow('project', 'lore', 'thin', 'parent'),
        pathRow('project', 'lore/child', 'body', 'child'),
        pathRow('project', 'lore/leaf', 'thin', 'leaf'),
      ],
      childCounts: { parent: 1 },
    });
    const summary = buildHygieneAudit(index, { category: 'placeholder_parents' });
    expect(summary.items).toEqual([{
      uri: 'project://lore',
      category: 'placeholder_parents',
      reason: 'thin_parent_with_children',
      chars: 4,
      child_count: 1,
    }]);
  });

  it('flags domains outside the canonical set', () => {
    const index = indexWith({
      paths: [
        pathRow('work', 'notes'),
        pathRow('project', 'lore'),
        pathRow('core', 'agent'),
        pathRow('preferences', 'user'),
      ],
    });
    const summary = buildHygieneAudit(index, { category: 'legacy_domains' });
    expect(summary.items).toEqual([{
      uri: 'work://notes',
      category: 'legacy_domains',
      reason: 'domain_outside_canonical_set',
      domain: 'work',
    }]);
  });

  it('pages categories with limit and offset', () => {
    const paths = Array.from({ length: 3 }, (_, i) => pathRow('project', `lore/long_${i}`, 'x'.repeat(OVERSIZED_CONTENT_CHARS + 1), `u${i}`));
    const index = indexWith({ paths });
    const page = buildHygieneAudit(index, { category: 'oversized', limit: 2, offset: 2 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
    expect(page.has_more).toBe(false);
  });
});

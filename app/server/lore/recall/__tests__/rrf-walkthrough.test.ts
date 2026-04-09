import { describe, it, vi } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../view/embeddings', () => ({
  embedTexts: vi.fn(), vectorLiteral: vi.fn(),
  resolveEmbeddingConfig: vi.fn((e: unknown) => e || {}), getEmbeddingRuntimeConfig: vi.fn(),
}));
vi.mock('../../search/glossarySemantic', () => ({ ensureGlossaryEmbeddingsIndex: vi.fn(), fetchGlossarySemanticRows: vi.fn() }));
vi.mock('../../view/viewCrud', () => ({ ensureMemoryViewsReady: vi.fn(), ensureMemoryViewsIndex: vi.fn() }));
vi.mock('../../view/viewBuilders', () => ({ countQueryTokens: vi.fn().mockResolvedValue(3) }));
vi.mock('../../view/memoryViewQueries', async (orig) => ({
  ...(await orig()),
  fetchDenseMemoryViewRows: vi.fn(), fetchLexicalMemoryViewRows: vi.fn(), fetchExactMemoryRows: vi.fn(),
}));
vi.mock('../recallEventLog', () => ({ logRecallEvents: vi.fn() }));
vi.mock('../../view/retrieval', () => ({ NORMALIZED_DOCUMENTS_CTE: '', loadNormalizedDocuments: vi.fn() }));

import { scenarios } from './recall-test-data';
import { collectCandidates, rrfStrategy, rawScoreStrategy, denseFloorStrategy } from './recall-strategies';
import { aggregateCandidates } from '../recall';

interface Scenario {
  id: string;
  description?: string;
  category: string;
  query_tokens?: number;
  exactRows: Record<string, unknown>[];
  glossarySemanticRows: Record<string, unknown>[];
  denseRows: Record<string, unknown>[];
  lexicalRows: Record<string, unknown>[];
  expected: {
    top1?: string;
    is_noise?: boolean;
    relevant_uris?: string[];
  };
}

interface ScoredItem {
  uri: string;
  score: number;
}

interface Candidate {
  uri: string;
  exact_score: number;
  glossary_semantic_score: number;
  dense_score: number;
  lexical_score: number;
  exact_rank: number;
  glossary_semantic_rank: number;
  dense_rank: number;
  lexical_rank: number;
  priority: number;
}

function rowsOf(sc: Scenario) {
  return { exactRows: sc.exactRows, glossarySemanticRows: sc.glossarySemanticRows, denseRows: sc.denseRows, lexicalRows: sc.lexicalRows };
}
function pad(s: string | number, n: number): string { const str = String(s); return str.length >= n ? str : str + ' '.repeat(n - str.length); }

describe('RRF walkthrough', () => {
  it('prints detailed breakdown for 3 representative scenarios', () => {
    const targetScenarios = ['xlong_noise_compaction_2k'];
    for (const sid of targetScenarios) {
      const sc = (scenarios as Scenario[]).find(s => s.id === sid);
      if (!sc) continue;
      console.log('\n' + '='.repeat(110));
      console.log(`SCENARIO: ${sc.id}  (tokens=${sc.query_tokens ?? 3}, category=${sc.category})`);
      console.log(`  ${sc.description}`);
      console.log(`  Expected top1: ${sc.expected.top1 || 'NONE (noise)'}${sc.expected.is_noise ? ' [is_noise]' : ''}`);
      console.log('='.repeat(110));
      console.log(`Input rows: exact=${sc.exactRows.length}, gs=${sc.glossarySemanticRows.length}, dense=${sc.denseRows.length}, lex=${sc.lexicalRows.length}`);

      const byUri = collectCandidates(rowsOf(sc));
      const items = [...byUri.values()] as Candidate[];
      const target = sc.expected.top1 || '(noise — no target)';

      // Per-path top-5
      console.log('\n--- Per-path top-5 URIs (by weighted raw score) ---');
      const fields = ['exact_score', 'glossary_semantic_score', 'dense_score', 'lexical_score'] as const;
      const labels = ['exact', 'gs', 'dense', 'lex'];
      for (let i = 0; i < 4; i++) {
        const sorted = items.filter(it => it[fields[i]] > 0).sort((a, b) => b[fields[i]] - a[fields[i]]);
        console.log(`  ${pad(labels[i] + ':', 7)} ${sorted.length} candidates`);
        for (let j = 0; j < Math.min(5, sorted.length); j++) {
          const mark = sorted[j].uri === target ? ' <- TARGET' : '';
          console.log(`    #${j+1}  ${pad(sorted[j].uri, 56)} @${sorted[j][fields[i]].toFixed(3)}${mark}`);
        }
      }

      // Target per-path ranks
      if (sc.expected.top1) {
        const targetItem = items.find(it => it.uri === target);
        console.log('\n--- TARGET per-path state ---');
        if (!targetItem) console.log('  target not in any path!');
        else {
          console.log(`  exact: raw=${targetItem.exact_score.toFixed(3)}, rank=${targetItem.exact_rank === Infinity ? '\u221E' : targetItem.exact_rank}`);
          console.log(`  gs:    raw=${targetItem.glossary_semantic_score.toFixed(3)}, rank=${targetItem.glossary_semantic_rank === Infinity ? '\u221E' : targetItem.glossary_semantic_rank}`);
          console.log(`  dense: raw=${targetItem.dense_score.toFixed(3)}, rank=${targetItem.dense_rank === Infinity ? '\u221E' : targetItem.dense_rank}`);
          console.log(`  lex:   raw=${targetItem.lexical_score.toFixed(3)}, rank=${targetItem.lexical_rank === Infinity ? '\u221E' : targetItem.lexical_rank}`);

          console.log('\n--- RRF k=20 calculation for TARGET ---');
          const k = 20;
          let sum = 0;
          const parts: string[] = [];
          const rankFields = ['exact_rank', 'glossary_semantic_rank', 'dense_rank', 'lexical_rank'] as const;
          for (let i = 0; i < 4; i++) {
            const r = targetItem[rankFields[i]];
            if (r === Infinity) { parts.push(`${labels[i]}:—`); continue; }
            const c = 1 / (k + r);
            sum += c;
            parts.push(`${labels[i]}: 1/${k + r}=${c.toFixed(4)}`);
          }
          const priorityBonus = Math.max(0, 0.03 - targetItem.priority * 0.005);
          console.log(`  ${parts.join('   ')}`);
          console.log(`  path_sum=${sum.toFixed(4)}  + priority(p=${targetItem.priority})=${priorityBonus.toFixed(4)}  = TOTAL ${(sum + priorityBonus).toFixed(4)}`);
        }
      }

      // Strategy top-3
      console.log('\n--- Strategy top-3 ---');
      const stratList: [string, ScoredItem[]][] = [
        ['A-Current ', aggregateCandidates(rowsOf(sc))],
        ['G-RawScore', rawScoreStrategy(rowsOf(sc), {})],
        ['C-RRF k=20', rrfStrategy(rowsOf(sc), { k: 20 })],
        ['J-DenseFloor strict', denseFloorStrategy(rowsOf(sc), { dense_floor: 0.50, gs_floor: 0.40 })],
      ];
      for (const [name, ranked] of stratList) {
        console.log(`  ${name}:`);
        for (let i = 0; i < Math.min(3, ranked.length); i++) {
          const mark = ranked[i].uri === target ? ' <- TARGET' : '';
          console.log(`    #${i+1}  ${pad(ranked[i].uri, 56)} @${ranked[i].score.toFixed(4)}${mark}`);
        }
        if (sc.expected.top1) {
          const targetPos = ranked.findIndex(r => r.uri === target);
          const pm = targetPos >= 0 ? `pos #${targetPos+1} @${ranked[targetPos].score.toFixed(4)}` : 'MISSING';
          console.log(`    [target: ${pm}]`);
        }
      }
    }
  });
});

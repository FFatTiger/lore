import { getSettings as getSettingsBatch } from '../config/settings';
import type { EmbeddingConfig } from '../core/types';
import { getBootUris } from '../memory/boot';
import { getEmbeddingRuntimeConfig, resolveEmbeddingConfig } from '../view/embeddings';
import { getMemoryViewRuntimeConfig } from '../view/memoryViewQueries';
import {
  DEFAULT_STRATEGY,
  STRATEGIES,
  type ScoringConfig,
} from './recallScoring';

export const SCORING_SETTING_KEYS = [
  'recall.scoring.strategy',
  'recall.scoring.rrf_k',
  'recall.scoring.dense_floor',
  'recall.scoring.gs_floor',
  'recall.weights.w_exact',
  'recall.weights.w_glossary_semantic',
  'recall.weights.w_dense',
  'recall.weights.w_lexical',
  'recall.bonus.priority_base',
  'recall.bonus.priority_step',
  'recall.bonus.multi_view_step',
  'recall.bonus.multi_view_cap',
  'recall.recency.enabled',
  'recall.recency.half_life_days',
  'recall.recency.max_bonus',
  'recall.recency.priority_exempt',
  'views.prior.gist',
  'views.prior.question',
] as const;

export interface LoadedScoringConfig extends ScoringConfig {
  strategy: string;
  rrf_k: number;
  dense_floor: number;
  gs_floor: number;
  recency_enabled: boolean;
  recency_half_life_days: number;
  recency_max_bonus: number;
  recency_priority_exempt: number;
  view_priors: { gist: number; question: number };
  query_tokens?: number;
}

export interface LoadedDisplayConfig {
  min_display_score: unknown;
  max_display_items: unknown;
  read_node_display_mode: unknown;
}

export async function loadRecallScoringConfig(): Promise<LoadedScoringConfig> {
  const s = await getSettingsBatch([...SCORING_SETTING_KEYS]);
  const rawStrategy = String(s['recall.scoring.strategy'] || DEFAULT_STRATEGY);
  const strategy = STRATEGIES.includes(rawStrategy as typeof STRATEGIES[number]) ? rawStrategy : DEFAULT_STRATEGY;
  return {
    strategy,
    rrf_k: Number(s['recall.scoring.rrf_k'] || 20),
    dense_floor: Number(s['recall.scoring.dense_floor'] || 0.50),
    gs_floor: Number(s['recall.scoring.gs_floor'] || 0.40),
    w_exact: s['recall.weights.w_exact'] as number,
    w_glossary_semantic: s['recall.weights.w_glossary_semantic'] as number,
    w_dense: s['recall.weights.w_dense'] as number,
    w_lexical: s['recall.weights.w_lexical'] as number,
    priority_base: s['recall.bonus.priority_base'] as number,
    priority_step: s['recall.bonus.priority_step'] as number,
    multi_view_step: s['recall.bonus.multi_view_step'] as number,
    multi_view_cap: s['recall.bonus.multi_view_cap'] as number,
    recency_enabled: s['recall.recency.enabled'] === true,
    recency_half_life_days: Number(s['recall.recency.half_life_days'] || 180),
    recency_max_bonus: Number(s['recall.recency.max_bonus'] || 0.04),
    recency_priority_exempt: Number(s['recall.recency.priority_exempt'] ?? 1),
    view_priors: {
      gist: Number(s['views.prior.gist'] ?? 0.03),
      question: Number(s['views.prior.question'] ?? 0.02),
    },
  };
}

export async function loadRecallDisplayConfig(): Promise<LoadedDisplayConfig> {
  const s = await getSettingsBatch([
    'recall.display.min_display_score',
    'recall.display.max_display_items',
    'recall.display.read_node_display_mode',
  ]);
  return {
    min_display_score: s['recall.display.min_display_score'],
    max_display_items: s['recall.display.max_display_items'],
    read_node_display_mode: s['recall.display.read_node_display_mode'],
  };
}

export async function getRecallRuntimeConfig(embedding: Partial<EmbeddingConfig> | null = null) {
  const resolvedEmbedding = await resolveEmbeddingConfig(embedding);
  const scoring = await loadRecallScoringConfig();
  const display = await loadRecallDisplayConfig();
  return {
    embedding: await getEmbeddingRuntimeConfig(resolvedEmbedding),
    memory_views: await getMemoryViewRuntimeConfig(resolvedEmbedding),
    scoring: {
      strategy: scoring.strategy,
      strategies_available: STRATEGIES,
      rrf_k: scoring.rrf_k,
      dense_floor: scoring.dense_floor,
      gs_floor: scoring.gs_floor,
    },
    recency: {
      enabled: scoring.recency_enabled,
      half_life_days: scoring.recency_half_life_days,
      max_bonus: scoring.recency_max_bonus,
      priority_exempt: scoring.recency_priority_exempt,
    },
    // kept under original key for UI backward compat
    normalized_linear: {
      w_exact: scoring.w_exact,
      w_glossary_semantic: scoring.w_glossary_semantic,
      w_dense: scoring.w_dense,
      w_lexical: scoring.w_lexical,
      priority_base: scoring.priority_base,
      priority_step: scoring.priority_step,
      multi_view_step: scoring.multi_view_step,
      multi_view_cap: scoring.multi_view_cap,
    },
    display,
    core_memory_uris: [...getBootUris()].sort(),
  };
}

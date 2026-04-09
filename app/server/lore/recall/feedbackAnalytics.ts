import { sql } from '../../db';
import { clampLimit } from '../core/utils';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function intervalDaysSql(days: unknown): number {
  return clampLimit(days, 1, 90, 30);
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toISO(value: unknown): string | null {
  return value ? new Date(value as string).toISOString() : null;
}

type Classification = 'dead' | 'noisy' | 'underperforming' | 'healthy';

interface ClassifyParams {
  recall_count: number;
  selected_count: number;
  used_in_answer_count: number;
  conversion_rate: number;
}

function classify({ recall_count, selected_count, used_in_answer_count: _used, conversion_rate }: ClassifyParams): Classification {
  if (recall_count === 0) return 'dead';
  if (selected_count === 0) return 'noisy';
  if (conversion_rate < 0.1 && selected_count >= 3) return 'underperforming';
  return 'healthy';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryHealthNode {
  node_uri: string;
  created_at: string | null;
  last_updated_at: string | null;
  update_count: number;
  recall_count: number;
  selected_count: number;
  used_in_answer_count: number;
  selection_rate: number;
  conversion_rate: number;
  days_to_first_recall: number | null;
  last_recalled_at: string | null;
  avg_selected_score: number | null;
  classification: Classification;
}

export interface ClassificationSummary {
  healthy: number;
  underperforming: number;
  dead: number;
  noisy: number;
  [key: string]: number;
}

export interface MemoryHealthReport {
  window_days: number;
  total_nodes: number;
  classification_summary: ClassificationSummary;
  nodes: MemoryHealthNode[];
}

export interface DeadWriteEntry {
  node_uri: string;
  created_at: string | null;
  source: string;
  domain: string;
  write_event_count: number;
  last_write_at: string | null;
  recall_appearances: number;
  avg_score_when_seen: number | null;
  diagnosis: 'retrieved_not_selected' | 'never_retrieved';
}

export interface DeadWritesReport {
  window_days: number;
  total_dead_writes: number;
  dead_writes: DeadWriteEntry[];
}

export interface PathEffectivenessRow {
  retrieval_path: string;
  total_appearances: number;
  selected_count: number;
  used_count: number;
  selection_rate: number;
  usage_rate: number;
  avg_score_overall: number | null;
  avg_score_when_selected: number | null;
  avg_score_when_used: number | null;
  avg_score_when_not_selected: number | null;
  avg_pre_rank_score: number | null;
  avg_pre_rank_when_selected: number | null;
  distinct_nodes: number;
  distinct_selected_nodes: number;
}

export interface PathRecommendation {
  path: string;
  action: 'decrease_weight' | 'increase_weight' | 'review_threshold';
  reason: string;
  severity: 'medium' | 'low' | 'info';
}

export interface PathEffectivenessReport {
  window_days: number;
  paths: PathEffectivenessRow[];
  recommendations: PathRecommendation[];
}

// ---------------------------------------------------------------------------
// A. Memory Health Report — per-node lifecycle analysis
// ---------------------------------------------------------------------------

export async function getMemoryHealthReport({ days = 30, limit = 20 }: { days?: number; limit?: number } = {}): Promise<MemoryHealthReport> {
  const safeDays = intervalDaysSql(days);
  const safeLimit = clampLimit(limit, 1, 100, 20);

  const result = await sql(
    `
      WITH write_stats AS (
        SELECT
          node_uri,
          MIN(created_at) FILTER (WHERE event_type = 'create') AS created_at,
          MAX(created_at) FILTER (WHERE event_type = 'update') AS last_updated_at,
          COUNT(*) FILTER (WHERE event_type = 'update') AS update_count
        FROM memory_events
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        GROUP BY node_uri
      ),
      recall_stats AS (
        SELECT
          node_uri,
          COUNT(*) AS recall_count,
          COUNT(*) FILTER (WHERE selected = TRUE) AS selected_count,
          COUNT(*) FILTER (WHERE used_in_answer = TRUE) AS used_in_answer_count,
          MIN(created_at) FILTER (WHERE selected = TRUE) AS first_selected_at,
          MAX(created_at) FILTER (WHERE selected = TRUE) AS last_recalled_at,
          AVG(final_rank_score) FILTER (WHERE selected = TRUE) AS avg_selected_score
        FROM recall_events
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        GROUP BY node_uri
      )
      SELECT
        COALESCE(w.node_uri, r.node_uri) AS node_uri,
        w.created_at,
        w.last_updated_at,
        COALESCE(w.update_count, 0) AS update_count,
        COALESCE(r.recall_count, 0) AS recall_count,
        COALESCE(r.selected_count, 0) AS selected_count,
        COALESCE(r.used_in_answer_count, 0) AS used_in_answer_count,
        r.first_selected_at,
        r.last_recalled_at,
        r.avg_selected_score
      FROM write_stats w
      FULL OUTER JOIN recall_stats r ON w.node_uri = r.node_uri
      WHERE EXISTS (
        SELECT 1 FROM paths p
        WHERE (p.domain || '://' || p.path) = COALESCE(w.node_uri, r.node_uri)
      )
      ORDER BY COALESCE(r.recall_count, 0) DESC, COALESCE(w.update_count, 0) DESC
      LIMIT $2
    `,
    [safeDays, safeLimit],
  );

  const summary: ClassificationSummary = { healthy: 0, underperforming: 0, dead: 0, noisy: 0 };
  const nodes: MemoryHealthNode[] = result.rows.map((row) => {
    const recall_count = Number(row.recall_count);
    const selected_count = Number(row.selected_count);
    const used_in_answer_count = Number(row.used_in_answer_count);
    const selection_rate = recall_count > 0 ? selected_count / recall_count : 0;
    const conversion_rate = selected_count > 0 ? used_in_answer_count / selected_count : 0;
    const days_to_first_recall = row.first_selected_at && row.created_at
      ? Math.max(0, (new Date(row.first_selected_at).getTime() - new Date(row.created_at).getTime()) / 86_400_000)
      : null;
    const classification = classify({ recall_count, selected_count, used_in_answer_count, conversion_rate });
    summary[classification] = (summary[classification] || 0) + 1;

    return {
      node_uri: row.node_uri as string,
      created_at: toISO(row.created_at),
      last_updated_at: toISO(row.last_updated_at),
      update_count: Number(row.update_count),
      recall_count,
      selected_count,
      used_in_answer_count,
      selection_rate: Number(selection_rate.toFixed(4)),
      conversion_rate: Number(conversion_rate.toFixed(4)),
      days_to_first_recall: days_to_first_recall !== null ? Number(days_to_first_recall.toFixed(1)) : null,
      last_recalled_at: toISO(row.last_recalled_at),
      avg_selected_score: asNumber(row.avg_selected_score),
      classification,
    };
  });

  return {
    window_days: safeDays,
    total_nodes: nodes.length,
    classification_summary: summary,
    nodes,
  };
}

// ---------------------------------------------------------------------------
// B. Dead Writes — memories created but never recalled (selected=true)
// ---------------------------------------------------------------------------

export async function getDeadWrites({ days = 30, limit = 20 }: { days?: number; limit?: number } = {}): Promise<DeadWritesReport> {
  const safeDays = intervalDaysSql(days);
  const safeLimit = clampLimit(limit, 1, 100, 20);

  // 1) Truly dead: never appeared in any recall result as selected
  // 2) Near-miss: appeared in recall results but never selected
  const [deadResult, nearMissResult] = await Promise.all([
    sql(
      `
        SELECT
          me.node_uri,
          MIN(me.created_at) AS created_at,
          MIN(me.source) AS source,
          MIN(me.domain) AS domain,
          COUNT(*) AS write_event_count,
          MAX(me.created_at) AS last_write_at
        FROM memory_events me
        WHERE me.event_type = 'create'
          AND me.created_at >= NOW() - ($1::int * INTERVAL '1 day')
          AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = me.node_uri)
          AND NOT EXISTS (
            SELECT 1 FROM recall_events re
            WHERE re.node_uri = me.node_uri
              AND re.selected = TRUE
              AND re.created_at >= me.created_at
          )
        GROUP BY me.node_uri
        ORDER BY MIN(me.created_at) DESC
        LIMIT $2
      `,
      [safeDays, safeLimit],
    ),
    sql(
      `
        SELECT
          me.node_uri,
          COUNT(DISTINCT re.id) AS recall_appearances,
          AVG(re.final_rank_score) AS avg_score_when_seen
        FROM memory_events me
        JOIN recall_events re ON re.node_uri = me.node_uri
          AND re.created_at >= me.created_at
        WHERE me.event_type = 'create'
          AND me.created_at >= NOW() - ($1::int * INTERVAL '1 day')
          AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = me.node_uri)
          AND NOT EXISTS (
            SELECT 1 FROM recall_events re2
            WHERE re2.node_uri = me.node_uri
              AND re2.selected = TRUE
              AND re2.created_at >= me.created_at
          )
        GROUP BY me.node_uri
        ORDER BY COUNT(DISTINCT re.id) DESC
        LIMIT $2
      `,
      [safeDays, safeLimit],
    ),
  ]);

  const nearMissMap = new Map(nearMissResult.rows.map((r) => [r.node_uri as string, r]));

  const dead_writes: DeadWriteEntry[] = deadResult.rows.map((row) => {
    const nearMiss = nearMissMap.get(row.node_uri as string);
    const recall_appearances = Number(nearMiss?.recall_appearances || 0);
    return {
      node_uri: row.node_uri as string,
      created_at: toISO(row.created_at),
      source: row.source as string,
      domain: row.domain as string,
      write_event_count: Number(row.write_event_count),
      last_write_at: toISO(row.last_write_at),
      recall_appearances,
      avg_score_when_seen: asNumber(nearMiss?.avg_score_when_seen),
      diagnosis: recall_appearances > 0 ? 'retrieved_not_selected' : 'never_retrieved',
    };
  });

  return {
    window_days: safeDays,
    total_dead_writes: dead_writes.length,
    dead_writes,
  };
}

// ---------------------------------------------------------------------------
// C. Path Effectiveness — per retrieval path selection/usage analysis
// ---------------------------------------------------------------------------

function generateRecommendations(pathRows: PathEffectivenessRow[]): PathRecommendation[] {
  const recommendations: PathRecommendation[] = [];
  for (const path of pathRows) {
    const selectionRate = path.selected_count / (path.total_appearances || 1);
    const usageRate = path.used_count / (path.selected_count || 1);
    const scoreLift = (path.avg_score_when_used || 0) - (path.avg_score_when_not_selected || 0);

    if (selectionRate < 0.15 && path.total_appearances >= 10) {
      recommendations.push({
        path: path.retrieval_path,
        action: 'decrease_weight',
        reason: `${path.retrieval_path} 选中率仅 ${(selectionRate * 100).toFixed(1)}%（${path.total_appearances} 次出现中）`,
        severity: 'medium',
      });
    }
    if (usageRate > 0.5 && path.selected_count >= 5) {
      recommendations.push({
        path: path.retrieval_path,
        action: 'increase_weight',
        reason: `${path.retrieval_path} 使用率达 ${(usageRate * 100).toFixed(1)}%（选中后）`,
        severity: 'low',
      });
    }
    if (scoreLift > 0.3 && path.used_count >= 3) {
      recommendations.push({
        path: path.retrieval_path,
        action: 'review_threshold',
        reason: `使用项与未选中项的分差达 ${scoreLift.toFixed(3)}`,
        severity: 'info',
      });
    }
  }
  return recommendations;
}

export async function getPathEffectiveness({ days = 30 }: { days?: number } = {}): Promise<PathEffectivenessReport> {
  const safeDays = intervalDaysSql(days);

  const result = await sql(
    `
      SELECT
        retrieval_path,
        COUNT(*) AS total_appearances,
        COUNT(*) FILTER (WHERE selected = TRUE) AS selected_count,
        COUNT(*) FILTER (WHERE used_in_answer = TRUE) AS used_count,
        AVG(final_rank_score) AS avg_score_overall,
        AVG(final_rank_score) FILTER (WHERE selected = TRUE) AS avg_score_when_selected,
        AVG(final_rank_score) FILTER (WHERE used_in_answer = TRUE) AS avg_score_when_used,
        AVG(final_rank_score) FILTER (WHERE selected = FALSE) AS avg_score_when_not_selected,
        AVG(pre_rank_score) AS avg_pre_rank_score,
        AVG(pre_rank_score) FILTER (WHERE selected = TRUE) AS avg_pre_rank_when_selected,
        COUNT(DISTINCT node_uri) AS distinct_nodes,
        COUNT(DISTINCT node_uri) FILTER (WHERE selected = TRUE) AS distinct_selected_nodes
      FROM recall_events
      WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)
      GROUP BY retrieval_path
      ORDER BY COUNT(*) FILTER (WHERE selected = TRUE) DESC
    `,
    [safeDays],
  );

  const paths: PathEffectivenessRow[] = result.rows.map((row) => {
    const total = Number(row.total_appearances);
    const selected = Number(row.selected_count);
    const used = Number(row.used_count);
    return {
      retrieval_path: row.retrieval_path as string,
      total_appearances: total,
      selected_count: selected,
      used_count: used,
      selection_rate: Number((selected / (total || 1)).toFixed(4)),
      usage_rate: Number((used / (selected || 1)).toFixed(4)),
      avg_score_overall: asNumber(row.avg_score_overall),
      avg_score_when_selected: asNumber(row.avg_score_when_selected),
      avg_score_when_used: asNumber(row.avg_score_when_used),
      avg_score_when_not_selected: asNumber(row.avg_score_when_not_selected),
      avg_pre_rank_score: asNumber(row.avg_pre_rank_score),
      avg_pre_rank_when_selected: asNumber(row.avg_pre_rank_when_selected),
      distinct_nodes: Number(row.distinct_nodes),
      distinct_selected_nodes: Number(row.distinct_selected_nodes),
    };
  });

  return {
    window_days: safeDays,
    paths,
    recommendations: generateRecommendations(paths),
  };
}

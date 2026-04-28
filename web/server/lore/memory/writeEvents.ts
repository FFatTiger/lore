import { normalizeClientType, type ClientType } from '../../auth';
import { sql } from '../../db';
import type { TransactionClient } from '../core/types';
import { clampLimit } from '../core/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WriteEventType =
  | 'create'
  | 'update'
  | 'delete'
  | 'move'
  | 'glossary_add'
  | 'glossary_remove'
  | 'hard_delete';

export interface NodeSnapshot {
  content?: string | null;
  priority?: number | null;
  disclosure?: string | null;
  [key: string]: unknown;
}

export interface LogMemoryEventOptions {
  /** pg client inside a transaction (uses client.query); omit for pool-level sql() */
  client?: TransactionClient | null;
  /** create | update | delete | move | glossary_add | glossary_remove | hard_delete */
  event_type: WriteEventType;
  /** e.g. 'core://soul' */
  node_uri: string;
  node_uuid?: string | null;
  domain?: string;
  path?: string;
  /** e.g. 'mcp:lore_create_node' or 'api:PUT /browse/node' */
  source?: string;
  session_id?: string | null;
  client_type?: ClientType | null;
  /** { content, priority, disclosure } before mutation */
  before_snapshot?: NodeSnapshot | null;
  /** { content, priority, disclosure } after mutation */
  after_snapshot?: NodeSnapshot | null;
  /** operation-specific metadata */
  details?: Record<string, unknown>;
}

export interface WriteEventStatsOptions {
  days?: number;
  limit?: number;
  eventType?: string;
  nodeUri?: string;
  source?: string;
}

export interface NodeWriteHistoryOptions {
  nodeUri?: string;
  nodeUuid?: string;
  limit?: number;
}

export interface FormattedEvent {
  id: number;
  event_type: string;
  node_uri: string;
  node_uuid: string | null;
  source: string;
  session_id: string | null;
  client_type: ClientType | null;
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  details: Record<string, unknown>;
  created_at: string | null;
}

export interface WriteEventStats {
  window_days: number;
  filters: { event_type: string | null; node_uri: string | null; source: string | null } | null;
  summary: {
    total_events: number;
    distinct_nodes: number;
    last_event_at: string | null;
  };
  by_event_type: Array<{ event_type: string; total: number }>;
  by_source: Array<{ source: string; total: number }>;
  hot_nodes: Array<{
    node_uri: string;
    total: number;
    creates: number;
    updates: number;
    deletes: number;
    last_event_at: string | null;
  }>;
  recent_events: FormattedEvent[];
}

export interface NodeWriteHistory {
  node_uri: string | null;
  node_uuid: string | null;
  events: FormattedEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function intervalDaysSql(days: number): number {
  return clampLimit(days, 1, 90, 7);
}

// ---------------------------------------------------------------------------
// Log a memory mutation event
// ---------------------------------------------------------------------------

/**
 * Log a memory mutation event. Supports both transaction-bound (client) and pool-level (sql) modes.
 */
export async function logMemoryEvent({
  client = null,
  event_type,
  node_uri,
  node_uuid = null,
  domain = 'core',
  path = '',
  source = 'unknown',
  session_id = null,
  client_type = null,
  before_snapshot = null,
  after_snapshot = null,
  details = {},
}: LogMemoryEventOptions): Promise<void> {
  const normalizedClientType = normalizeClientType(client_type);
  const normalizedDetails = { ...(details || {}) };
  if (normalizedClientType) normalizedDetails.client_type = normalizedClientType;
  const query = `
    INSERT INTO memory_events (event_type, node_uri, node_uuid, domain, path, source, session_id, before_snapshot, after_snapshot, details, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
  `;
  const values: unknown[] = [
    event_type,
    node_uri || '',
    node_uuid,
    domain || 'core',
    path || '',
    source || 'unknown',
    session_id || null,
    before_snapshot ? JSON.stringify(before_snapshot) : null,
    after_snapshot ? JSON.stringify(after_snapshot) : null,
    JSON.stringify(normalizedDetails),
  ];
  if (client) {
    await client.query(query, values as unknown[]);
  } else {
    await sql(query, values);
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function sanitizeFilter(value: unknown, maxChars = 240): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxChars) : '';
}

function eventClientType(details: Record<string, unknown>): ClientType | null {
  return normalizeClientType(details.client_type);
}

function formatEventRow(row: Record<string, unknown>): FormattedEvent {
  const details = (row.details as Record<string, unknown>) || {};
  return {
    id: Number(row.id),
    event_type: row.event_type as string,
    node_uri: row.node_uri as string,
    node_uuid: (row.node_uuid as string | null) || null,
    source: row.source as string,
    session_id: (row.session_id as string | null) || null,
    client_type: eventClientType(details),
    before_snapshot: (row.before_snapshot as Record<string, unknown> | null) || null,
    after_snapshot: (row.after_snapshot as Record<string, unknown> | null) || null,
    details,
    created_at: row.created_at ? new Date(row.created_at as string).toISOString() : null,
  };
}

export async function getWriteEventStats({
  days = 7,
  limit = 20,
  eventType = '',
  nodeUri = '',
  source = '',
}: WriteEventStatsOptions = {}): Promise<WriteEventStats> {
  const safeDays = intervalDaysSql(days);
  const safeLimit = clampLimit(limit, 3, 100, 20);

  const clauses: string[] = [
    `created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
    `EXISTS (SELECT 1 FROM paths p WHERE (p.domain || '://' || p.path) = node_uri)`,
  ];
  const params: unknown[] = [safeDays];

  const safeEventType = sanitizeFilter(eventType, 60);
  const safeNodeUri = sanitizeFilter(nodeUri, 240);
  const safeSource = sanitizeFilter(source, 120);

  if (safeEventType) { params.push(safeEventType); clauses.push(`event_type = $${params.length}`); }
  if (safeNodeUri) { params.push(safeNodeUri); clauses.push(`node_uri = $${params.length}`); }
  if (safeSource) { params.push(safeSource); clauses.push(`source = $${params.length}`); }

  const where = clauses.join(' AND ');
  const hasFilter = !!(safeEventType || safeNodeUri || safeSource);

  const [summary, byType, bySource, hotNodes, recentEvents] = await Promise.all([
    sql(
      `SELECT COUNT(*) AS total_events,
        COUNT(DISTINCT node_uri) AS distinct_nodes,
        MAX(created_at) AS last_event_at
       FROM memory_events WHERE ${where}`,
      params,
    ),
    sql(
      `SELECT event_type, COUNT(*) AS total
       FROM memory_events WHERE ${where}
       GROUP BY event_type ORDER BY total DESC`,
      params,
    ),
    sql(
      `SELECT source, COUNT(*) AS total
       FROM memory_events WHERE ${where}
       GROUP BY source ORDER BY total DESC`,
      params,
    ),
    sql(
      `SELECT node_uri, COUNT(*) AS total,
        COUNT(*) FILTER (WHERE event_type = 'create') AS creates,
        COUNT(*) FILTER (WHERE event_type = 'update') AS updates,
        COUNT(*) FILTER (WHERE event_type = 'delete') AS deletes,
        MAX(created_at) AS last_event_at
       FROM memory_events WHERE ${where}
       GROUP BY node_uri ORDER BY total DESC, node_uri ASC
       LIMIT $${params.length + 1}`,
      [...params, safeLimit],
    ),
    sql(
      `SELECT id, event_type, node_uri, node_uuid, source, session_id,
        before_snapshot, after_snapshot, details, created_at
       FROM memory_events WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 1}`,
      [...params, safeLimit],
    ),
  ]);

  const summaryRow = (summary.rows[0] || {}) as Record<string, unknown>;
  return {
    window_days: safeDays,
    filters: hasFilter ? { event_type: safeEventType || null, node_uri: safeNodeUri || null, source: safeSource || null } : null,
    summary: {
      total_events: Number(summaryRow.total_events || 0),
      distinct_nodes: Number(summaryRow.distinct_nodes || 0),
      last_event_at: summaryRow.last_event_at ? new Date(summaryRow.last_event_at as string).toISOString() : null,
    },
    by_event_type: byType.rows.map((r) => ({ event_type: (r as Record<string, unknown>).event_type as string, total: Number((r as Record<string, unknown>).total) })),
    by_source: bySource.rows.map((r) => ({ source: (r as Record<string, unknown>).source as string, total: Number((r as Record<string, unknown>).total) })),
    hot_nodes: hotNodes.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        node_uri: row.node_uri as string,
        total: Number(row.total),
        creates: Number(row.creates),
        updates: Number(row.updates),
        deletes: Number(row.deletes),
        last_event_at: row.last_event_at ? new Date(row.last_event_at as string).toISOString() : null,
      };
    }),
    recent_events: recentEvents.rows.map((r) => formatEventRow(r as Record<string, unknown>)),
  };
}

export async function getNodeWriteHistory({
  nodeUri = '',
  nodeUuid = '',
  limit = 50,
}: NodeWriteHistoryOptions = {}): Promise<NodeWriteHistory | { events: [] }> {
  const safeLimit = clampLimit(limit, 1, 200, 50);
  const safeUri = sanitizeFilter(nodeUri, 240);
  const safeUuid = sanitizeFilter(nodeUuid, 120);

  if (!safeUri && !safeUuid) return { events: [] };

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (safeUri) { params.push(safeUri); clauses.push(`node_uri = $${params.length}`); }
  if (safeUuid) { params.push(safeUuid); clauses.push(`node_uuid = $${params.length}`); }

  const where = clauses.join(' OR ');
  params.push(safeLimit);

  const result = await sql(
    `SELECT id, event_type, node_uri, node_uuid, domain, path, source, session_id,
      before_snapshot, after_snapshot, details, created_at
     FROM memory_events WHERE ${where}
     ORDER BY created_at ASC, id ASC
     LIMIT $${params.length}`,
    params,
  );

  return {
    node_uri: safeUri || null,
    node_uuid: safeUuid || null,
    events: result.rows.map((r) => formatEventRow(r as Record<string, unknown>)),
  };
}

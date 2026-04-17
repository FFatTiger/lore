import { CLIENT_TYPES, normalizeClientType, type ClientType } from '../../auth';
import { sql } from '../../db';

export interface LatestWriteMeta {
  last_updated_client_type: ClientType | null;
  last_updated_source: string | null;
  last_updated_at: string | null;
}

export interface UpdaterSummary {
  client_type: ClientType | null;
  source: string | null;
  updated_at: string | null;
  event_count: number;
}

export function emptyLatestWriteMeta(): LatestWriteMeta {
  return {
    last_updated_client_type: null,
    last_updated_source: null,
    last_updated_at: null,
  };
}

export function emptyUpdaterSummaries(): UpdaterSummary[] {
  return [];
}

function formatLatestWriteMeta(row?: Record<string, unknown> | null): LatestWriteMeta {
  if (!row) return emptyLatestWriteMeta();
  return {
    last_updated_client_type: normalizeClientType(row.client_type),
    last_updated_source: typeof row.source === 'string' && row.source.trim() ? row.source : null,
    last_updated_at: row.created_at ? new Date(row.created_at as string).toISOString() : null,
  };
}

function formatUpdaterSummary(row?: Record<string, unknown> | null): UpdaterSummary | null {
  if (!row) return null;
  return {
    client_type: normalizeClientType(row.client_type),
    source: typeof row.source === 'string' && row.source.trim() ? row.source : null,
    updated_at: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
    event_count: Math.max(1, Number(row.event_count || 1)),
  };
}

const NORMALIZED_EVENT_CLIENT_TYPE_SQL = `
  CASE
    WHEN LOWER(BTRIM(COALESCE(details->>'client_type', ''))) IN (${CLIENT_TYPES.map((clientType) => `'${clientType}'`).join(', ')})
      THEN LOWER(BTRIM(details->>'client_type'))
    ELSE NULL
  END
`;

export async function getLatestWriteMetaByNodeUuid(nodeUuids: string[]): Promise<Map<string, LatestWriteMeta>> {
  const safeNodeUuids = [...new Set(
    (Array.isArray(nodeUuids) ? nodeUuids : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
  if (safeNodeUuids.length === 0) return new Map();

  const result = await sql(
    `
      SELECT DISTINCT ON (node_uuid)
        node_uuid,
        source,
        details->>'client_type' AS client_type,
        created_at,
        id
      FROM memory_events
      WHERE node_uuid = ANY($1::text[])
      ORDER BY node_uuid ASC, created_at DESC, id DESC
    `,
    [safeNodeUuids],
  );

  const map = new Map<string, LatestWriteMeta>();
  for (const rawRow of result.rows as Record<string, unknown>[]) {
    const nodeUuid = String(rawRow.node_uuid || '').trim();
    if (!nodeUuid) continue;
    map.set(nodeUuid, formatLatestWriteMeta(rawRow));
  }
  return map;
}

export async function getUpdaterSummariesByNodeUuid(nodeUuids: string[]): Promise<Map<string, UpdaterSummary[]>> {
  const safeNodeUuids = [...new Set(
    (Array.isArray(nodeUuids) ? nodeUuids : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
  if (safeNodeUuids.length === 0) return new Map();

  const result = await sql(
    `
      SELECT
        node_uuid,
        ${NORMALIZED_EVENT_CLIENT_TYPE_SQL} AS client_type,
        source,
        MAX(created_at) AS updated_at,
        COUNT(*) AS event_count
      FROM memory_events
      WHERE node_uuid = ANY($1::text[])
      GROUP BY node_uuid, ${NORMALIZED_EVENT_CLIENT_TYPE_SQL}, source
      ORDER BY node_uuid ASC, MAX(created_at) DESC, COUNT(*) DESC, source ASC
    `,
    [safeNodeUuids],
  );

  const map = new Map<string, UpdaterSummary[]>();
  for (const rawRow of result.rows as Record<string, unknown>[]) {
    const nodeUuid = String(rawRow.node_uuid || '').trim();
    if (!nodeUuid) continue;
    const summary = formatUpdaterSummary(rawRow);
    if (!summary) continue;
    const existing = map.get(nodeUuid) || [];
    existing.push(summary);
    map.set(nodeUuid, existing);
  }
  return map;
}

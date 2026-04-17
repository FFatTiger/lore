import { sql } from '../../db';
import type { ClientType } from '../../auth';
import { ROOT_NODE_UUID } from '../core/constants';
import { parseUri } from '../core/utils';
import { scheduleGeneratedArtifactsRefresh as scheduleSharedGeneratedArtifactsRefresh } from '../core/generatedArtifacts';
import { logMemoryEvent } from '../memory/writeEvents';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PathRow {
  domain: string;
  path: string;
}

interface EventContext {
  source?: string;
  session_id?: string | null;
  client_type?: ClientType | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getNodeUuidByPath(domain: string, path: string): Promise<string | null> {
  if (!path) return ROOT_NODE_UUID;
  const result = await sql(
    `
      SELECT e.child_uuid AS node_uuid
      FROM paths p
      JOIN edges e ON p.edge_id = e.id
      WHERE p.domain = $1 AND p.path = $2
      LIMIT 1
    `,
    [domain, path],
  );
  return (result.rows[0] as any)?.node_uuid || null;
}

async function listPathsByNodeUuid(nodeUuid: string): Promise<PathRow[]> {
  const result = await sql(
    `
      SELECT p.domain, p.path
      FROM paths p
      JOIN edges e ON p.edge_id = e.id
      WHERE e.child_uuid = $1
      ORDER BY p.domain ASC, p.path ASC
    `,
    [nodeUuid],
  );
  return result.rows as PathRow[];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function scheduleGeneratedArtifactsRefresh(paths: PathRow[]): void {
  scheduleSharedGeneratedArtifactsRefresh(paths, 'glossary refresh', { defaultDomain: null });
}

export async function getGlossary(): Promise<{ glossary: Array<{ keyword: string; node_uuid: string }> }> {
  const result = await sql(
    `SELECT keyword, node_uuid FROM glossary_keywords ORDER BY keyword ASC, node_uuid ASC`,
  );
  return { glossary: result.rows as Array<{ keyword: string; node_uuid: string }> };
}

export async function addGlossaryKeyword(
  { keyword, node_uuid }: { keyword: string; node_uuid: string },
  eventContext: EventContext = {},
): Promise<{ success: boolean; keyword: string; node_uuid: string }> {
  await sql(
    `INSERT INTO glossary_keywords (keyword, node_uuid, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
    [keyword, node_uuid],
  );
  const paths = await listPathsByNodeUuid(node_uuid);
  const primaryUri = paths[0] ? `${paths[0].domain}://${paths[0].path}` : `[uuid]/${node_uuid}`;
  logMemoryEvent({
    event_type: 'glossary_add',
    node_uri: primaryUri,
    node_uuid,
    domain: paths[0]?.domain || 'core',
    path: paths[0]?.path || '',
    source: eventContext.source || 'unknown',
    session_id: eventContext.session_id || null,
    client_type: eventContext.client_type || null,
    after_snapshot: { keyword },
    details: {},
  }).catch((err) => console.error('[write_events] glossary_add log failed', err));
  scheduleGeneratedArtifactsRefresh(paths);
  return { success: true, keyword, node_uuid };
}

export async function removeGlossaryKeyword(
  { keyword, node_uuid }: { keyword: string; node_uuid: string },
  eventContext: EventContext = {},
): Promise<{ success: boolean }> {
  const result = await sql(
    `DELETE FROM glossary_keywords WHERE keyword = $1 AND node_uuid = $2`,
    [keyword, node_uuid],
  );
  if ((result.rowCount ?? 0) > 0) {
    const paths = await listPathsByNodeUuid(node_uuid);
    const primaryUri = paths[0] ? `${paths[0].domain}://${paths[0].path}` : `[uuid]/${node_uuid}`;
    logMemoryEvent({
      event_type: 'glossary_remove',
      node_uri: primaryUri,
      node_uuid,
      domain: paths[0]?.domain || 'core',
      path: paths[0]?.path || '',
      source: eventContext.source || 'unknown',
      session_id: eventContext.session_id || null,
      client_type: eventContext.client_type || null,
      before_snapshot: { keyword },
      details: {},
    }).catch((err) => console.error('[write_events] glossary_remove log failed', err));
    scheduleGeneratedArtifactsRefresh(paths);
  }
  return { success: (result.rowCount ?? 0) > 0 };
}

export async function manageTriggers(
  { uri, add = [], remove = [] }: { uri: string; add?: string[]; remove?: string[] },
  eventContext: EventContext = {},
): Promise<{
  success: boolean;
  uri: string;
  added: string[];
  skipped_add: string[];
  removed: string[];
  skipped_remove: string[];
  current: string[];
}> {
  const { domain, path } = parseUri(uri);
  const nodeUuid = await getNodeUuidByPath(domain, path);
  if (!nodeUuid) {
    const error: any = new Error(`Memory at '${domain}://${path}' not found.`);
    error.status = 404;
    throw error;
  }

  const nodeUri = `${domain}://${path}`;
  const added: string[] = [];
  const skipped_add: string[] = [];
  const removed: string[] = [];
  const skipped_remove: string[] = [];

  for (const raw of add) {
    const keyword = String(raw || '').trim();
    if (!keyword) continue;
    const before = await sql(`SELECT 1 FROM glossary_keywords WHERE keyword = $1 AND node_uuid = $2 LIMIT 1`, [keyword, nodeUuid]);
    if (before.rows[0]) {
      skipped_add.push(keyword);
      continue;
    }
    await sql(`INSERT INTO glossary_keywords (keyword, node_uuid, created_at) VALUES ($1, $2, NOW())`, [keyword, nodeUuid]);
    added.push(keyword);
    logMemoryEvent({
      event_type: 'glossary_add', node_uri: nodeUri, node_uuid: nodeUuid, domain, path,
      source: eventContext.source || 'unknown', session_id: eventContext.session_id || null,
      client_type: eventContext.client_type || null,
      after_snapshot: { keyword }, details: {},
    }).catch((err) => console.error('[write_events] glossary_add log failed', err));
  }

  for (const raw of remove) {
    const keyword = String(raw || '').trim();
    if (!keyword) continue;
    const result = await sql(`DELETE FROM glossary_keywords WHERE keyword = $1 AND node_uuid = $2`, [keyword, nodeUuid]);
    if ((result.rowCount ?? 0) > 0) {
      removed.push(keyword);
      logMemoryEvent({
        event_type: 'glossary_remove', node_uri: nodeUri, node_uuid: nodeUuid, domain, path,
        source: eventContext.source || 'unknown', session_id: eventContext.session_id || null,
        client_type: eventContext.client_type || null,
        before_snapshot: { keyword }, details: {},
      }).catch((err) => console.error('[write_events] glossary_remove log failed', err));
    } else {
      skipped_remove.push(keyword);
    }
  }

  const currentResult = await sql(`SELECT keyword FROM glossary_keywords WHERE node_uuid = $1 ORDER BY keyword ASC`, [nodeUuid]);
  scheduleGeneratedArtifactsRefresh(await listPathsByNodeUuid(nodeUuid));
  return {
    success: true,
    uri: nodeUri,
    added,
    skipped_add,
    removed,
    skipped_remove,
    current: (currentResult.rows as any[]).map((row) => row.keyword),
  };
}

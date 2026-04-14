import crypto from 'crypto';
import type { ClientType } from '../../auth';
import { getPool } from '../../db';
import { ROOT_NODE_UUID } from './browse';
import {
  deleteGeneratedMemoryViewsByPrefix,
  upsertGeneratedMemoryViewsForPath,
} from '../view/viewCrud';
import {
  deleteGeneratedGlossaryEmbeddingsByPrefix,
  upsertGeneratedGlossaryEmbeddingsForPath,
} from '../search/glossarySemantic';
import { logMemoryEvent } from './writeEvents';
import type { TransactionClient, URI } from '../core/types';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PathContext {
  domain: string;
  path: string;
  edge_id: number;
  parent_uuid: string;
  child_uuid: string;
  priority: number;
  disclosure: string | null;
}

interface EventContext {
  source?: string;
  session_id?: string | null;
  client_type?: ClientType | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getPathContext(
  client: TransactionClient,
  domain: string,
  path: string,
): Promise<PathContext | null> {
  const result = await client.query(
    `
      SELECT p.domain, p.path, e.id AS edge_id, e.parent_uuid, e.child_uuid, e.priority, e.disclosure
      FROM paths p
      JOIN edges e ON p.edge_id = e.id
      WHERE p.domain = $1 AND p.path = $2
      LIMIT 1
    `,
    [domain, path],
  );
  return (result.rows[0] as PathContext) || null;
}

const PATH_SEGMENT_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function scheduleGeneratedViewRefresh(domain: string, path: string): void {
  const normalizedDomain = String(domain || 'core').trim() || 'core';
  const normalizedPath = String(path || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!normalizedPath) return;
  queueMicrotask(() => {
    upsertGeneratedMemoryViewsForPath({ domain: normalizedDomain, path: normalizedPath }).catch(
      (error: unknown) => {
        console.error('[memory_views] refresh failed', normalizedDomain, normalizedPath, error);
      },
    );
    upsertGeneratedGlossaryEmbeddingsForPath({
      domain: normalizedDomain,
      path: normalizedPath,
    }).catch((error: unknown) => {
      console.error('[glossary_embeddings] refresh failed', normalizedDomain, normalizedPath, error);
    });
  });
}

function scheduleGeneratedViewDelete(domain: string, path: string): void {
  const normalizedDomain = String(domain || 'core').trim() || 'core';
  const normalizedPath = String(path || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!normalizedPath) return;
  queueMicrotask(() => {
    deleteGeneratedMemoryViewsByPrefix({ domain: normalizedDomain, path: normalizedPath }).catch(
      (error: unknown) => {
        console.error('[memory_views] delete failed', normalizedDomain, normalizedPath, error);
      },
    );
    deleteGeneratedGlossaryEmbeddingsByPrefix({
      domain: normalizedDomain,
      path: normalizedPath,
    }).catch((error: unknown) => {
      console.error('[glossary_embeddings] delete failed', normalizedDomain, normalizedPath, error);
    });
  });
}

function assertValidPathSegment(value: unknown, label = 'path segment'): string {
  const segment = String(value || '').trim();
  if (!segment) {
    const error = Object.assign(new Error(`${label} is required`), { status: 422 });
    throw error;
  }
  if (!PATH_SEGMENT_RE.test(segment)) {
    const error = Object.assign(
      new Error(
        `${label} must use snake_case ASCII only (lowercase letters, digits, underscores; no Chinese, spaces, or hyphens)`,
      ),
      { status: 422 },
    );
    throw error;
  }
  return segment;
}

function assertValidPathSegments(path: unknown, label = 'path'): string[] {
  const segments = String(path || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) {
    const error = Object.assign(
      new Error(`${label} must include at least one path segment`),
      { status: 422 },
    );
    throw error;
  }
  for (const segment of segments) {
    assertValidPathSegment(segment, label);
  }
  return segments;
}

function parseUri(uri: unknown): URI {
  const value = String(uri || '').trim();
  if (value.includes('://')) {
    const [d, p] = value.split('://', 2);
    return { domain: d.trim() || 'core', path: (p ?? '').replace(/^\/+|\/+$/g, '') };
  }
  return { domain: 'core', path: value.replace(/^\/+|\/+$/g, '') };
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export interface CreateNodeOptions {
  domain?: string;
  parentPath?: string;
  content?: string;
  priority?: number;
  title?: string;
  disclosure?: string | null;
}

export interface CreateNodeResult {
  success: true;
  uri: string;
  path: string;
  node_uuid: string;
}

export async function createNode(
  {
    domain = 'core',
    parentPath = '',
    content,
    priority = 0,
    title,
    disclosure = null,
  }: CreateNodeOptions,
  eventContext: EventContext = {},
): Promise<CreateNodeResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    let parentUuid = ROOT_NODE_UUID;
    if (parentPath) {
      const parentCtx = await getPathContext(client, domain, parentPath);
      if (!parentCtx) {
        const error = Object.assign(
          new Error(`Parent path not found: ${domain}://${parentPath}`),
          { status: 422 },
        );
        throw error;
      }
      parentUuid = parentCtx.child_uuid;
    }

    let slug = (title || '').trim();
    if (!slug) {
      const siblingResult = await client.query(
        `SELECT p.path FROM paths p JOIN edges e ON p.edge_id = e.id WHERE e.parent_uuid = $1 AND p.domain = $2`,
        [parentUuid, domain],
      );
      let maxNum = 0;
      for (const row of siblingResult.rows as { path: string }[]) {
        const segment = (row.path || '').split('/').pop() || '';
        const n = Number(segment);
        if (Number.isFinite(n)) maxNum = Math.max(maxNum, n);
      }
      slug = String(maxNum + 1);
    }
    slug = assertValidPathSegment(slug, 'title/path segment');

    const childUuid = crypto.randomUUID();
    await client.query(`INSERT INTO nodes (uuid, created_at) VALUES ($1, NOW())`, [childUuid]);
    await client.query(
      `INSERT INTO memories (node_uuid, content, deprecated, migrated_to, created_at) VALUES ($1, $2, FALSE, NULL, NOW())`,
      [childUuid, content],
    );
    const edgeResult = await client.query(
      `
        INSERT INTO edges (parent_uuid, child_uuid, priority, disclosure, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING id
      `,
      [parentUuid, childUuid, priority, disclosure],
    );
    const edgeId = (edgeResult.rows[0] as { id: number }).id;
    const path = parentPath ? `${parentPath}/${slug}` : slug;
    await client.query(
      `INSERT INTO paths (domain, path, edge_id, created_at) VALUES ($1, $2, $3, NOW())`,
      [domain, path, edgeId],
    );

    await logMemoryEvent({
      client,
      event_type: 'create',
      node_uri: `${domain}://${path}`,
      node_uuid: childUuid,
      domain,
      path,
      source: eventContext.source || 'unknown',
      session_id: eventContext.session_id || null,
      client_type: eventContext.client_type || null,
      before_snapshot: null,
      after_snapshot: { content, priority, disclosure },
      details: { parent_path: parentPath, title: slug },
    });

    await client.query('COMMIT');
    scheduleGeneratedViewRefresh(domain, path);
    return { success: true, uri: `${domain}://${path}`, path, node_uuid: childUuid };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface UpdateNodeByPathOptions {
  domain?: string;
  path: string;
  content?: string;
  priority?: number;
  disclosure?: string | null;
}

export interface UpdateNodeResult {
  success: true;
  node_uuid: string;
}

export async function updateNodeByPath(
  { domain = 'core', path, content, priority, disclosure }: UpdateNodeByPathOptions,
  eventContext: EventContext = {},
): Promise<UpdateNodeResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const ctx = await getPathContext(client, domain, path);
    if (!ctx) {
      const error = Object.assign(new Error(`Path not found: ${domain}://${path}`), { status: 404 });
      throw error;
    }

    let beforeContent: string | null = null;
    let contentChanged = false;

    if (content !== undefined) {
      const currentMemoryResult = await client.query(
        `
          SELECT id, content
          FROM memories
          WHERE node_uuid = $1 AND deprecated = FALSE
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE
        `,
        [ctx.child_uuid],
      );
      const currentMemory = currentMemoryResult.rows[0] as
        | { id: number; content: string }
        | undefined;
      beforeContent = currentMemory?.content ?? null;
      if (currentMemory && currentMemory.content !== content) {
        contentChanged = true;
        await client.query(
          `
            UPDATE memories
            SET deprecated = TRUE, migrated_to = NULL
            WHERE id = $1
          `,
          [currentMemory.id],
        );
        await client.query(
          `
            INSERT INTO memories (node_uuid, content, deprecated, migrated_to, created_at)
            VALUES ($1, $2, FALSE, NULL, NOW())
          `,
          [ctx.child_uuid, content],
        );
      }
    }

    if (priority !== undefined || disclosure !== undefined) {
      await client.query(
        `
          UPDATE edges
          SET priority = COALESCE($2, priority),
              disclosure = CASE WHEN $3::text IS NULL THEN disclosure ELSE $3 END
          WHERE id = $1
        `,
        [ctx.edge_id, priority ?? null, disclosure ?? null],
      );
    }

    await logMemoryEvent({
      client,
      event_type: 'update',
      node_uri: `${domain}://${path}`,
      node_uuid: ctx.child_uuid,
      domain,
      path,
      source: eventContext.source || 'unknown',
      session_id: eventContext.session_id || null,
      client_type: eventContext.client_type || null,
      before_snapshot: {
        content: beforeContent,
        priority: ctx.priority,
        disclosure: ctx.disclosure,
      },
      after_snapshot: {
        content: content ?? beforeContent,
        priority: priority ?? ctx.priority,
        disclosure: disclosure ?? ctx.disclosure,
      },
      details: {
        content_changed: contentChanged,
        priority_changed: priority !== undefined,
        disclosure_changed: disclosure !== undefined,
      },
    });

    await client.query('COMMIT');
    scheduleGeneratedViewRefresh(domain, path);
    return { success: true, node_uuid: ctx.child_uuid };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface DeleteNodeByPathOptions {
  domain?: string;
  path: string;
}

export interface DeleteNodeResult {
  success: true;
  deleted_uri: string;
}

export async function deleteNodeByPath(
  { domain = 'core', path }: DeleteNodeByPathOptions,
  eventContext: EventContext = {},
): Promise<DeleteNodeResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const baseCtx = await getPathContext(client, domain, path);
    if (!baseCtx) {
      const error = Object.assign(new Error(`Path not found: ${domain}://${path}`), { status: 404 });
      throw error;
    }

    // Capture content before deletion for the event log
    const beforeMemoryResult = await client.query(
      `SELECT content FROM memories WHERE node_uuid = $1 AND deprecated = FALSE ORDER BY created_at DESC LIMIT 1`,
      [baseCtx.child_uuid],
    );
    const beforeContent = (beforeMemoryResult.rows[0] as { content: string } | undefined)?.content ?? null;

    const pathRows = await client.query(
      `
        SELECT p.domain, p.path, p.edge_id, e.child_uuid
        FROM paths p
        JOIN edges e ON p.edge_id = e.id
        WHERE p.domain = $1 AND (p.path = $2 OR p.path LIKE $3)
        ORDER BY LENGTH(p.path) DESC
      `,
      [domain, path, `${path}/%`],
    );

    const edgeIds = [
      ...new Set((pathRows.rows as { edge_id: number }[]).map((row) => row.edge_id)),
    ];
    const affectedNodeUuids = [
      ...new Set((pathRows.rows as { child_uuid: string }[]).map((row) => row.child_uuid)),
    ];

    await client.query(
      `DELETE FROM paths WHERE domain = $1 AND (path = $2 OR path LIKE $3)`,
      [domain, path, `${path}/%`],
    );

    for (const edgeId of edgeIds) {
      const refCount = await client.query(
        `SELECT COUNT(*) AS count FROM paths WHERE edge_id = $1`,
        [edgeId],
      );
      if (Number((refCount.rows[0] as { count: string } | undefined)?.count || 0) === 0) {
        await client.query(`DELETE FROM edges WHERE id = $1`, [edgeId]);
      }
    }

    for (const nodeUuid of affectedNodeUuids) {
      const pathCount = await client.query(
        `SELECT COUNT(*) AS count FROM paths p JOIN edges e ON p.edge_id = e.id WHERE e.child_uuid = $1`,
        [nodeUuid],
      );
      if (Number((pathCount.rows[0] as { count: string } | undefined)?.count || 0) === 0) {
        await client.query(
          `UPDATE memories SET deprecated = TRUE, migrated_to = NULL WHERE node_uuid = $1 AND deprecated = FALSE`,
          [nodeUuid],
        );
      }
    }

    await logMemoryEvent({
      client,
      event_type: 'delete',
      node_uri: `${domain}://${path}`,
      node_uuid: baseCtx.child_uuid,
      domain,
      path,
      source: eventContext.source || 'unknown',
      session_id: eventContext.session_id || null,
      client_type: eventContext.client_type || null,
      before_snapshot: {
        content: beforeContent,
        priority: baseCtx.priority,
        disclosure: baseCtx.disclosure,
      },
      after_snapshot: null,
      details: {
        affected_paths: (pathRows.rows as { domain: string; path: string }[]).map(
          (r) => `${r.domain}://${r.path}`,
        ),
        deprecated_node_uuids: affectedNodeUuids,
      },
    });

    await client.query('COMMIT');
    scheduleGeneratedViewDelete(domain, path);
    return { success: true, deleted_uri: `${domain}://${path}` };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface MoveNodeOptions {
  old_uri: string;
  new_uri: string;
}

export interface MoveNodeResult {
  success: true;
  old_uri: string;
  new_uri: string;
  node_uuid: string;
}

export async function moveNode(
  { old_uri, new_uri }: MoveNodeOptions,
  eventContext: EventContext = {},
): Promise<MoveNodeResult> {
  const old = parseUri(old_uri);
  const target = parseUri(new_uri);
  assertValidPathSegments(target.path, 'new_uri path');

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const oldCtx = await getPathContext(client, old.domain, old.path);
    if (!oldCtx) {
      throw Object.assign(new Error(`Source path not found: ${old_uri}`), { status: 422 });
    }

    // Check new path doesn't already exist
    const existingResult = await client.query(
      `SELECT 1 FROM paths WHERE domain = $1 AND path = $2 LIMIT 1`,
      [target.domain, target.path],
    );
    if (existingResult.rows.length > 0) {
      throw Object.assign(new Error(`Target path already exists: ${new_uri}`), { status: 409 });
    }

    // Update the node's own path
    await client.query(
      `UPDATE paths SET domain = $1, path = $2 WHERE domain = $3 AND path = $4`,
      [target.domain, target.path, old.domain, old.path],
    );

    // Update all child paths that start with the old prefix
    const oldPrefix = old.path + '/';
    await client.query(
      `UPDATE paths SET domain = $1, path = $2 || SUBSTRING(path, $3) WHERE domain = $4 AND path LIKE $5`,
      [target.domain, target.path, oldPrefix.length + 1, old.domain, oldPrefix + '%'],
    );

    await logMemoryEvent({
      client,
      event_type: 'move',
      node_uri: new_uri,
      node_uuid: oldCtx.child_uuid,
      domain: target.domain,
      path: target.path,
      source: eventContext.source || 'unknown',
      session_id: eventContext.session_id || null,
      client_type: eventContext.client_type || null,
      before_snapshot: { uri: old_uri },
      after_snapshot: { uri: new_uri },
      details: { old_uri, new_uri, operation: 'move' },
    });

    // Collect moved child paths before commit (already updated to new prefix)
    const movedChildren = await client.query(
      `SELECT path FROM paths WHERE domain = $1 AND path LIKE $2`,
      [target.domain, target.path + '/%'],
    );

    await client.query('COMMIT');

    // Delete old views/glossary at old prefix, then refresh at new prefix
    scheduleGeneratedViewDelete(old.domain, old.path);
    scheduleGeneratedViewRefresh(target.domain, target.path);
    for (const row of movedChildren.rows) {
      scheduleGeneratedViewRefresh(target.domain, row.path as string);
    }

    return { success: true, old_uri, new_uri, node_uuid: oldCtx.child_uuid };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Export internal helpers for testing
export { assertValidPathSegment, assertValidPathSegments, parseUri };

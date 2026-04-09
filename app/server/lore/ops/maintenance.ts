import { sql } from '../../db';
import { logMemoryEvent } from '../memory/writeEvents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationTarget {
  id: number;
  content: string;
  content_snippet: string;
  created_at: string | null;
  deprecated: boolean;
  paths: string[];
}

export interface OrphanMigrationTarget {
  id: number;
  paths: string[];
  content_snippet: string;
}

export interface OrphanItem {
  id: number;
  content_snippet: string;
  created_at: string | null;
  deprecated: true;
  migrated_to: number | null;
  category: 'deprecated' | 'orphaned';
  migration_target: OrphanMigrationTarget | null;
}

export interface OrphanDetail {
  id: number;
  content: string;
  created_at: string | null;
  deprecated: boolean;
  migrated_to: number | null;
  category: 'active' | 'deprecated' | 'orphaned';
  migration_target: {
    id: number;
    content: string;
    paths: string[];
    created_at: string | null;
  } | null;
}

export interface DeleteResult {
  deleted_memory_id: number;
  chain_repaired_to: number | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveMigrationChain(memoryId: number): Promise<MigrationTarget | null> {
  let currentId: number | null = memoryId;
  while (currentId) {
    const memoryResult = await sql(
      `SELECT id, node_uuid, content, created_at, deprecated, migrated_to FROM memories WHERE id = $1 LIMIT 1`,
      [currentId],
    );
    const memory = memoryResult.rows[0];
    if (!memory) return null;

    if (!memory.migrated_to) {
      const pathsResult = await sql(
        `
          SELECT p.domain, p.path
          FROM paths p
          JOIN edges e ON p.edge_id = e.id
          WHERE e.child_uuid = $1
          ORDER BY p.domain, p.path
        `,
        [memory.node_uuid],
      );
      const paths = pathsResult.rows.map((row) => `${row.domain}://${row.path}`);
      return {
        id: memory.id as number,
        content: memory.content as string,
        content_snippet: (memory.content as string).length > 200 ? `${(memory.content as string).slice(0, 200)}...` : (memory.content as string),
        created_at: memory.created_at ? new Date(memory.created_at as string).toISOString() : null,
        deprecated: memory.deprecated as boolean,
        paths,
      };
    }

    currentId = memory.migrated_to as number;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listOrphans(): Promise<OrphanItem[]> {
  const result = await sql(
    `
      SELECT id, content, created_at, deprecated, migrated_to
      FROM memories
      WHERE deprecated = TRUE
      ORDER BY created_at DESC
    `,
  );

  const items: OrphanItem[] = [];
  for (const memory of result.rows) {
    const item: OrphanItem = {
      id: memory.id as number,
      content_snippet: (memory.content as string).length > 200 ? `${(memory.content as string).slice(0, 200)}...` : (memory.content as string),
      created_at: memory.created_at ? new Date(memory.created_at as string).toISOString() : null,
      deprecated: true,
      migrated_to: memory.migrated_to as number | null,
      category: memory.migrated_to ? 'deprecated' : 'orphaned',
      migration_target: null,
    };

    if (memory.migrated_to) {
      const target = await resolveMigrationChain(memory.migrated_to as number);
      if (target) {
        item.migration_target = {
          id: target.id,
          paths: target.paths,
          content_snippet: target.content_snippet,
        };
      }
    }

    items.push(item);
  }

  return items;
}

export async function getOrphanDetail(memoryId: number): Promise<OrphanDetail | null> {
  const result = await sql(
    `SELECT id, content, created_at, deprecated, migrated_to FROM memories WHERE id = $1 LIMIT 1`,
    [memoryId],
  );
  const memory = result.rows[0];
  if (!memory) return null;

  const detail: OrphanDetail = {
    id: memory.id as number,
    content: memory.content as string,
    created_at: memory.created_at ? new Date(memory.created_at as string).toISOString() : null,
    deprecated: memory.deprecated as boolean,
    migrated_to: memory.migrated_to as number | null,
    category: !memory.deprecated ? 'active' : memory.migrated_to ? 'deprecated' : 'orphaned',
    migration_target: null,
  };

  if (memory.migrated_to) {
    const target = await resolveMigrationChain(memory.migrated_to as number);
    if (target) {
      detail.migration_target = {
        id: target.id,
        content: target.content,
        paths: target.paths,
        created_at: target.created_at,
      };
    }
  }

  return detail;
}

export async function permanentlyDeleteDeprecatedMemory(
  memoryId: number,
  eventContext: { source?: string; session_id?: string | null } = {},
): Promise<DeleteResult> {
  const client = await (await import('../../db')).getPool().connect();
  try {
    await client.query('BEGIN');

    const targetResult = await client.query(
      `SELECT id, node_uuid, deprecated, migrated_to FROM memories WHERE id = $1 LIMIT 1`,
      [memoryId],
    );
    const target = targetResult.rows[0];
    if (!target) {
      const error = Object.assign(new Error(`Memory ${memoryId} not found`), { status: 404 });
      throw error;
    }
    if (!target.deprecated) {
      const error = Object.assign(
        new Error(`Memory ${memoryId} is active (deprecated=false). Deletion aborted.`),
        { status: 409 },
      );
      throw error;
    }

    await client.query(
      `UPDATE memories SET migrated_to = $2 WHERE migrated_to = $1`,
      [memoryId, target.migrated_to],
    );
    await client.query(`DELETE FROM memories WHERE id = $1`, [memoryId]);

    let nodeCascaded = false;
    if (target.node_uuid) {
      const countResult = await client.query(`SELECT COUNT(*) AS count FROM memories WHERE node_uuid = $1`, [target.node_uuid]);
      if (Number(countResult.rows[0]?.count || 0) === 0) {
        nodeCascaded = true;
        await client.query(`DELETE FROM glossary_keywords WHERE node_uuid = $1`, [target.node_uuid]);
        await client.query(`DELETE FROM paths WHERE edge_id IN (SELECT id FROM edges WHERE parent_uuid = $1 OR child_uuid = $1)`, [target.node_uuid]);
        await client.query(`DELETE FROM edges WHERE parent_uuid = $1 OR child_uuid = $1`, [target.node_uuid]);
        await client.query(`DELETE FROM nodes WHERE uuid = $1`, [target.node_uuid]);
      }
    }

    await logMemoryEvent({
      client,
      event_type: 'hard_delete',
      node_uri: `[memory]/${memoryId}`,
      node_uuid: target.node_uuid || null,
      source: eventContext.source || 'unknown',
      session_id: eventContext.session_id || null,
      before_snapshot: { memory_id: memoryId, node_uuid: target.node_uuid, deprecated: true, migrated_to: target.migrated_to },
      after_snapshot: null,
      details: { chain_repaired_to: target.migrated_to, node_cascaded: nodeCascaded },
    });

    await client.query('COMMIT');
    return { deleted_memory_id: memoryId as number, chain_repaired_to: target.migrated_to as number | null };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

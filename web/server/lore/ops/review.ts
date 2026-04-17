import { sql, getPool } from '../../db';
import {
  getChangesetPath,
  loadChangeset,
  removeChangesetFile,
  saveChangeset,
} from './reviewChangesetStore';
import { extractContentAndMeta, listActivePaths } from './reviewDiffState';
import {
  collectNodeRowKeys,
  collectReviewDiffChanges,
  determineReviewGroupAction,
  groupChangedRowsByNode,
} from './reviewGroupHelpers';
import {
  buildEdgeResolutionMap,
  findDisplayUri,
  resolveNodeUuidSync,
} from './reviewNodeResolution';
import {
  deleteSnapshotRow,
  insertSnapshotRow,
  updateSnapshotRow,
} from './reviewSnapshotRows';
import {
  extractTopTable,
  getAllRows,
  getChangedRows,
  makeRowKey,
  rowsEqual,
  type ChangesetData,
  type ChangesetRow,
} from './reviewRowHelpers';

interface ReviewGroup {
  node_uuid: string;
  display_uri: string;
  top_level_table: string;
  action: string;
  row_count: number;
}

interface ReviewGroupDiff {
  uri: string;
  change_type: string;
  action: string;
  before_content: string | null;
  current_content: string | null;
  before_meta: { priority: number | null; disclosure: string | null };
  current_meta: { priority: number | null; disclosure: string | null };
  path_changes: Array<{ action: string; uri: string }> | null;
  glossary_changes: Array<{ action: string; keyword: string }> | null;
  active_paths: string[] | null;
  has_changes: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listReviewGroups(): Promise<ReviewGroup[]> {
  const data = await loadChangeset();
  const allRows = getAllRows(data);
  const changedRows = getChangedRows(data);
  const dbEdgeToNode = await buildEdgeResolutionMap(allRows);

  const groupedRows = groupChangedRowsByNode(changedRows, allRows, dbEdgeToNode);

  const result: ReviewGroup[] = [];
  for (const [nodeUuid, rows] of groupedRows.entries()) {
    const topTable = extractTopTable(rows);
    const topRows = rows.filter((row) => row.table === topTable);

    result.push({
      node_uuid: nodeUuid,
      display_uri: await findDisplayUri(nodeUuid, allRows, dbEdgeToNode),
      top_level_table: topTable,
      action: determineReviewGroupAction(topRows),
      row_count: rows.length,
    });
  }

  return result.sort((a, b) => a.display_uri.localeCompare(b.display_uri));
}

export async function getReviewGroupDiff(nodeUuid: string): Promise<ReviewGroupDiff> {
  const data = await loadChangeset();
  const allRows = getAllRows(data);
  const changedRows = getChangedRows(data);
  const dbEdgeToNode = await buildEdgeResolutionMap(allRows);

  const rows = changedRows.filter((row) => resolveNodeUuidSync(row, allRows, dbEdgeToNode) === nodeUuid);
  if (!rows.length) {
    const error = new Error(`No changes for node '${nodeUuid}'`) as Error & { status: number };
    error.status = 404;
    throw error;
  }

  const topTable = extractTopTable(rows);
  const topRows = rows.filter((row) => row.table === topTable);
  const action = determineReviewGroupAction(topRows);

  const { path_changes, glossary_changes } = collectReviewDiffChanges(rows);

  const active_paths = await listActivePaths(nodeUuid);

  const beforeState = await extractContentAndMeta(rows, 'before', nodeUuid);
  const afterState = await extractContentAndMeta(rows, 'after', nodeUuid);

  return {
    uri: nodeUuid,
    change_type: topTable,
    action,
    before_content: beforeState.content,
    current_content: afterState.content,
    before_meta: beforeState.meta,
    current_meta: afterState.meta,
    path_changes,
    glossary_changes,
    active_paths: active_paths.length ? active_paths : null,
    has_changes:
      beforeState.content !== afterState.content ||
      JSON.stringify(beforeState.meta) !== JSON.stringify(afterState.meta) ||
      Boolean(glossary_changes?.length) ||
      Boolean(path_changes?.length),
  };
}

export async function approveReviewGroup(nodeUuid: string): Promise<{ message: string }> {
  const data = await loadChangeset();
  const allRows = getAllRows(data);
  const dbEdgeToNode = await buildEdgeResolutionMap(allRows);

  const keysToRemove = collectNodeRowKeys(allRows, dbEdgeToNode, nodeUuid);

  if (!keysToRemove.length) {
    const error = new Error(`No changes for '${nodeUuid}'`) as Error & { status: number };
    error.status = 404;
    throw error;
  }

  for (const key of keysToRemove) {
    delete data.rows[key];
  }

  if (Object.keys(data.rows).length === 0) await removeChangesetFile();
  else await saveChangeset(data);

  return { message: `Approved node '${nodeUuid}' (${keysToRemove.length} rows cleared)` };
}

export async function rollbackReviewGroup(nodeUuid: string): Promise<{
  node_uuid: string;
  success: boolean;
  message: string;
}> {
  const data = await loadChangeset();
  const allRows = getAllRows(data);
  const changedRows = getChangedRows(data);
  const dbEdgeToNode = await buildEdgeResolutionMap(allRows);
  const rows = changedRows.filter((row) => resolveNodeUuidSync(row, allRows, dbEdgeToNode) === nodeUuid);
  if (!rows.length) {
    const error = new Error(`No changes for '${nodeUuid}'`) as Error & { status: number };
    error.status = 404;
    throw error;
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const createdRows = rows.filter((row) => row.before == null && row.after != null);
    const deletedRows = rows.filter((row) => row.before != null && row.after == null);
    const updatedRows = rows.filter((row) => row.before != null && row.after != null);

    const deleteOrder = ['paths', 'glossary_keywords', 'edges', 'memories', 'nodes'];
    for (const table of deleteOrder) {
      for (const row of createdRows.filter((item) => item.table === table)) {
        await deleteSnapshotRow(client, table, row.after!);
      }
    }

    const insertOrder = ['nodes', 'memories', 'edges', 'paths', 'glossary_keywords'];
    for (const table of insertOrder) {
      for (const row of deletedRows.filter((item) => item.table === table)) {
        await insertSnapshotRow(client, table, row.before!);
      }
    }

    for (const row of updatedRows) {
      await updateSnapshotRow(client, row.table, row.before!, row.after!);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const keysToRemove = collectNodeRowKeys(allRows, dbEdgeToNode, nodeUuid);
  for (const key of keysToRemove) delete data.rows[key];
  if (Object.keys(data.rows).length === 0) await removeChangesetFile();
  else await saveChangeset(data);

  return { node_uuid: nodeUuid, success: true, message: `Rolled back ${rows.length} tracked row changes.` };
}

export async function clearAllReviewGroups(): Promise<{ message: string }> {
  const data = await loadChangeset();
  const count = getChangedRows(data).length;
  if (count === 0) {
    const error = new Error('No pending changes') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  await removeChangesetFile();
  return { message: `All changes integrated (${count} row changes cleared)` };
}

// Re-export internal helpers for testing
export {
  getChangesetPath as _getChangesetPath,
  loadChangeset as _loadChangeset,
  saveChangeset as _saveChangeset,
  removeChangesetFile as _removeChangesetFile,
  makeRowKey as _makeRowKey,
  rowsEqual as _rowsEqual,
  getAllRows as _getAllRows,
  getChangedRows as _getChangedRows,
  resolveNodeUuidSync as _resolveNodeUuidSync,
  extractTopTable as _extractTopTable,
};

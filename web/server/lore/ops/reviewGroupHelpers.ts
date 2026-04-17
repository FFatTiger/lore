import { makeRowKey, type ChangesetRow } from './reviewRowHelpers';
import { resolveNodeUuidSync } from './reviewNodeResolution';

export function groupChangedRowsByNode(
  changedRows: ChangesetRow[],
  allRows: ChangesetRow[],
  dbEdgeToNode: Record<number, string>,
): Map<string, ChangesetRow[]> {
  const groups = new Map<string, ChangesetRow[]>();
  for (const row of changedRows) {
    const ref = row.before || row.after;
    if (!ref) continue;
    const nodeUuid = resolveNodeUuidSync(row, allRows, dbEdgeToNode);
    if (!nodeUuid) continue;
    const list = groups.get(nodeUuid) || [];
    list.push(row);
    groups.set(nodeUuid, list);
  }
  return groups;
}

export function determineReviewGroupAction(rows: ChangesetRow[]): string {
  if (rows.every((row) => row.before == null && row.after != null)) return 'created';
  if (rows.every((row) => row.before != null && row.after == null)) return 'deleted';
  return 'modified';
}

export function collectNodeRowKeys(
  allRows: ChangesetRow[],
  dbEdgeToNode: Record<number, string>,
  nodeUuid: string,
): string[] {
  const keys: string[] = [];
  for (const row of allRows) {
    const ref = row.before || row.after;
    if (!ref) continue;
    if (resolveNodeUuidSync(row, allRows, dbEdgeToNode) === nodeUuid) {
      keys.push(makeRowKey(row.table, ref));
    }
  }
  return keys;
}

export function collectReviewDiffChanges(rows: ChangesetRow[]): {
  path_changes: Array<{ action: string; uri: string }> | null;
  glossary_changes: Array<{ action: string; keyword: string }> | null;
} {
  const path_changes: Array<{ action: string; uri: string }> = [];
  const glossary_changes: Array<{ action: string; keyword: string }> = [];

  for (const row of rows) {
    if (row.table === 'paths') {
      if (!row.before && row.after) {
        path_changes.push({ action: 'created', uri: `${row.after.domain}://${row.after.path}` });
      }
      if (row.before && !row.after) {
        path_changes.push({ action: 'deleted', uri: `${row.before.domain}://${row.before.path}` });
      }
    }

    if (row.table === 'glossary_keywords') {
      if (!row.before && row.after) {
        glossary_changes.push({ action: 'created', keyword: row.after.keyword as string });
      }
      if (row.before && !row.after) {
        glossary_changes.push({ action: 'deleted', keyword: row.before.keyword as string });
      }
    }
  }

  return {
    path_changes: path_changes.length ? path_changes : null,
    glossary_changes: glossary_changes.length ? glossary_changes : null,
  };
}

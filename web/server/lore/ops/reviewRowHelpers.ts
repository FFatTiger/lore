export interface ChangesetRow {
  table: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ChangesetData {
  rows: Record<string, ChangesetRow>;
}

const TABLE_PKS: Record<string, string | string[]> = {
  nodes: 'uuid',
  memories: 'id',
  edges: 'id',
  paths: ['domain', 'path'],
  glossary_keywords: ['keyword', 'node_uuid'],
};

export function makeRowKey(table: string, row: Record<string, unknown>): string {
  const pkDef = TABLE_PKS[table];
  if (Array.isArray(pkDef)) {
    return `${table}:${pkDef.map((key) => String(row[key])).join('|')}`;
  }
  return `${table}:${String(row[pkDef])}`;
}

export function rowsEqual(table: string, a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (table === 'glossary_keywords') {
    const clean = (value: Record<string, unknown>) => {
      const out = { ...value };
      delete out.id;
      delete out.created_at;
      return out;
    };
    return JSON.stringify(clean(a)) === JSON.stringify(clean(b));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export function getAllRows(data: ChangesetData): ChangesetRow[] {
  return Object.values(data?.rows || {});
}

export function getChangedRows(data: ChangesetData): ChangesetRow[] {
  return getAllRows(data).filter((entry) => !rowsEqual(entry.table, entry.before, entry.after));
}

export function extractTopTable(rows: ChangesetRow[]): string {
  const TABLE_RANK: Record<string, number> = { nodes: 5, memories: 4, edges: 3, paths: 2, glossary_keywords: 1 };
  const RANK_TO_TABLE: Record<number, string> = { 5: 'nodes', 4: 'memories', 3: 'edges', 2: 'paths', 1: 'glossary_keywords' };
  const topRank = Math.max(...rows.map((row) => TABLE_RANK[row.table] || 1), 1);
  return RANK_TO_TABLE[topRank];
}

export function getTableColumns(table: string): string[] {
  switch (table) {
    case 'nodes':
      return ['uuid', 'created_at'];
    case 'memories':
      return ['id', 'node_uuid', 'content', 'deprecated', 'migrated_to', 'created_at'];
    case 'edges':
      return ['id', 'parent_uuid', 'child_uuid', 'name', 'priority', 'disclosure', 'created_at'];
    case 'paths':
      return ['domain', 'path', 'edge_id', 'created_at'];
    case 'glossary_keywords':
      return ['id', 'keyword', 'node_uuid', 'created_at'];
    default:
      return [];
  }
}

export function getPkColumns(table: string): string[] {
  const def = TABLE_PKS[table];
  return Array.isArray(def) ? def : [def];
}

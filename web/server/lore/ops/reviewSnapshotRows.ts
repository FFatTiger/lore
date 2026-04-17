import { getPkColumns, getTableColumns } from './reviewRowHelpers';

interface ReviewSnapshotClient {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
}

export async function insertSnapshotRow(
  client: ReviewSnapshotClient,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  const columns = getTableColumns(table).filter((column) => Object.prototype.hasOwnProperty.call(row, column));
  const values = columns.map((_, index) => `$${index + 1}`);
  const sqlText = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING`;
  await client.query(sqlText, columns.map((column) => row[column]));
}

export async function deleteSnapshotRow(
  client: ReviewSnapshotClient,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  const pkColumns = getPkColumns(table);
  const where = pkColumns.map((column, index) => `${column} = $${index + 1}`).join(' AND ');
  await client.query(`DELETE FROM ${table} WHERE ${where}`, pkColumns.map((column) => row[column]));
}

export async function updateSnapshotRow(
  client: ReviewSnapshotClient,
  table: string,
  beforeRow: Record<string, unknown>,
  afterRow: Record<string, unknown>,
): Promise<void> {
  const pkColumns = getPkColumns(table);
  const assignable = getTableColumns(table).filter(
    (column) => !pkColumns.includes(column) && Object.prototype.hasOwnProperty.call(beforeRow, column),
  );
  if (!assignable.length) return;
  const setClause = assignable.map((column, index) => `${column} = $${index + 1}`).join(', ');
  const whereClause = pkColumns
    .map((column, index) => `${column} = $${assignable.length + index + 1}`)
    .join(' AND ');
  const values = [
    ...assignable.map((column) => beforeRow[column]),
    ...pkColumns.map((column) => (afterRow || beforeRow)[column]),
  ];
  await client.query(`UPDATE ${table} SET ${setClause} WHERE ${whereClause}`, values);
}

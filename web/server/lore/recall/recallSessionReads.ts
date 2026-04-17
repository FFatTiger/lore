import { sql } from '../../db';

export async function getSessionReadUris(sessionId: string | null | undefined): Promise<Set<string>> {
  const readUris = new Set<string>();
  if (!sessionId) return readUris;
  const readResult = await sql(`SELECT uri FROM session_read_nodes WHERE session_id = $1`, [sessionId]);
  for (const row of readResult.rows) readUris.add(row.uri as string);
  return readUris;
}

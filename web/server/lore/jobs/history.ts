import { sql } from '../../db';
import type { JobRunRecord } from './types';

function parseInsertedRunId(rawId: unknown, errorPrefix: string): number {
  const runId = Number(rawId);
  if (!Number.isInteger(runId) || !Number.isSafeInteger(runId) || runId <= 0) {
    throw new Error(`${errorPrefix}: invalid RETURNING id`);
  }
  return runId;
}

export async function claimScheduledJobRun(
  jobId: string,
  slotKey: string,
  details: Record<string, unknown> = {},
): Promise<{ claimed: boolean; runId: number | null }> {
  const result = await sql(
    `INSERT INTO job_runs (job_id, trigger, slot_key, status, details, created_at, updated_at)
     VALUES ($1, $2, $3, 'claimed', $4::jsonb, NOW(), NOW())
     ON CONFLICT (job_id, slot_key) WHERE slot_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [jobId, 'scheduled', slotKey, JSON.stringify(details)],
  );

  const rows = result.rows ?? [];
  const errorPrefix = `Failed to claim scheduled job run for job "${jobId}" and slot "${slotKey}"`;

  const rowCount = result.rowCount ?? undefined;

  if (rowCount !== undefined) {
    if (rowCount > 1) {
      throw new Error(`${errorPrefix}: expected rowCount <= 1, got ${rowCount}`);
    }

    if (rowCount === 0) {
      if (rows.length === 0) {
        return { claimed: false, runId: null };
      }
      throw new Error(`${errorPrefix}: rowCount was 0 but ${rows.length} row(s) were returned`);
    }

    if (rows.length > 1) {
      throw new Error(`${errorPrefix}: rowCount was 1 but ${rows.length} row(s) were returned`);
    }
  } else {
    if (rows.length === 0) {
      return { claimed: false, runId: null };
    }
    if (rows.length > 1) {
      throw new Error(`${errorPrefix}: expected one returned row when rowCount is undefined, got ${rows.length}`);
    }
  }

  const runId = parseInsertedRunId(rows[0]?.id, errorPrefix);

  return { claimed: true, runId };
}

export async function startManualJobRun(
  jobId: string,
  details: Record<string, unknown> = {},
): Promise<{ runId: number }> {
  const result = await sql(
    `INSERT INTO job_runs (job_id, trigger, slot_key, status, details, created_at, updated_at)
     VALUES ($1, $2, $3, 'claimed', $4::jsonb, NOW(), NOW())
     RETURNING id`,
    [jobId, 'manual', null, JSON.stringify(details)],
  );
  const rows = result.rows ?? [];
  const rowCount = result.rowCount ?? undefined;
  const errorPrefix = `Failed to create manual job run for job "${jobId}"`;

  if (rowCount !== undefined && rowCount !== 1) {
    throw new Error(`${errorPrefix}: expected rowCount 1, got ${rowCount}`);
  }
  if (rows.length !== 1) {
    throw new Error(`${errorPrefix}: expected one returned row, got ${rows.length}`);
  }

  const runId = parseInsertedRunId(rows[0]?.id, errorPrefix);
  return { runId };
}

export async function markJobRunRunning(runId: number): Promise<void> {
  const result = await sql(
    `UPDATE job_runs
     SET status = 'running', started_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [runId],
  );
  if (result.rowCount === 0) {
    throw new Error(`Failed to mark job run ${runId} as running: no row updated`);
  }
  if (result.rowCount !== 1) {
    throw new Error(`Failed to mark job run ${runId} as running: expected 1 updated row, got ${result.rowCount}`);
  }
}

export async function completeJobRun(
  runId: number,
  durationMs: number,
  details: Record<string, unknown> = {},
): Promise<void> {
  const result = await sql(
    `UPDATE job_runs
     SET status = 'completed', completed_at = NOW(), duration_ms = $2, details = details || $3::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [runId, durationMs, JSON.stringify(details)],
  );
  if (result.rowCount === 0) {
    throw new Error(`Failed to complete job run ${runId}: no row updated`);
  }
  if (result.rowCount !== 1) {
    throw new Error(`Failed to complete job run ${runId}: expected 1 updated row, got ${result.rowCount}`);
  }
}

export async function failJobRun(
  runId: number,
  durationMs: number,
  error: unknown,
  details: Record<string, unknown> = {},
): Promise<void> {
  const result = await sql(
    `UPDATE job_runs
     SET status = 'error', completed_at = NOW(), duration_ms = $2, error = $3, details = details || $4::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [runId, durationMs, (error as Error)?.message || String(error), JSON.stringify(details)],
  );
  if (result.rowCount === 0) {
    throw new Error(`Failed to fail job run ${runId}: no row updated`);
  }
  if (result.rowCount !== 1) {
    throw new Error(`Failed to fail job run ${runId}: expected 1 updated row, got ${result.rowCount}`);
  }
}

export async function listJobRuns({ job_id, limit = 50 }: { job_id?: string; limit?: number } = {}): Promise<JobRunRecord[]> {
  const clampedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  if (job_id) {
    const result = await sql(
      `SELECT * FROM job_runs WHERE job_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [job_id, clampedLimit],
    );
    return result.rows as JobRunRecord[];
  }
  const result = await sql(
    `SELECT * FROM job_runs ORDER BY created_at DESC LIMIT $1`,
    [clampedLimit],
  );
  return result.rows as JobRunRecord[];
}

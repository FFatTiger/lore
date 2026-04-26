import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));

import { sql } from '../../../db';
import { claimScheduledJobRun, completeJobRun, failJobRun, listJobRuns, markJobRunRunning, startManualJobRun } from '../history';

const mockSql = vi.mocked(sql);

function makeResult(rows: Record<string, unknown>[] = [], rowCount: number | undefined = rows.length) {
  return rowCount === undefined ? ({ rows } as any) : ({ rows, rowCount } as any);
}

describe('job history helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims a scheduled run atomically by job and slot', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 7 }], 1));

    const result = await claimScheduledJobRun('dream', 'daily:2026-04-26', { date: '2026-04-26' });

    expect(result).toEqual({ claimed: true, runId: 7 });
    expect(mockSql.mock.calls[0][0]).toContain('ON CONFLICT (job_id, slot_key) WHERE slot_key IS NOT NULL DO NOTHING');
    expect(mockSql.mock.calls[0][1]).toEqual(['dream', 'scheduled', 'daily:2026-04-26', JSON.stringify({ date: '2026-04-26' })]);
  });

  it('throws when scheduled insert reports one row but RETURNING id is missing', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{}], 1));

    await expect(claimScheduledJobRun('dream', 'daily:2026-04-26')).rejects.toThrow(
      'Failed to claim scheduled job run for job "dream" and slot "daily:2026-04-26": invalid RETURNING id',
    );
  });

  it('throws when scheduled insert reports one row but RETURNING id is invalid', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 'not-a-number' }], 1));

    await expect(claimScheduledJobRun('dream', 'daily:2026-04-26')).rejects.toThrow(
      'Failed to claim scheduled job run for job "dream" and slot "daily:2026-04-26": invalid RETURNING id',
    );
  });

  it('accepts a valid small string id from scheduled inserts', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: '7' }], 1));

    await expect(claimScheduledJobRun('dream', 'daily:2026-04-26')).resolves.toEqual({ claimed: true, runId: 7 });
  });

  it('rejects unsafe integer string ids from scheduled inserts', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: String(Number.MAX_SAFE_INTEGER + 10) }], 1));

    await expect(claimScheduledJobRun('dream', 'daily:2026-04-26')).rejects.toThrow(
      'Failed to claim scheduled job run for job "dream" and slot "daily:2026-04-26": invalid RETURNING id',
    );
  });

  it('throws when scheduled insert rowCount is greater than one', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 7 }, { id: 8 }], 2));

    await expect(claimScheduledJobRun('dream', 'daily:2026-04-26')).rejects.toThrow(
      'Failed to claim scheduled job run for job "dream" and slot "daily:2026-04-26": expected rowCount <= 1, got 2',
    );
  });

  it('throws when scheduled insert rowCount is zero but one row is returned', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 7 }], 0));

    await expect(claimScheduledJobRun('dream', 'daily:2026-04-26')).rejects.toThrow(
      'rowCount was 0 but 1 row(s) were returned',
    );
  });

  it('accepts a valid id when rowCount is undefined and exactly one row is returned', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 11 }], undefined));

    await expect(claimScheduledJobRun('dream', 'daily:2026-04-26')).resolves.toEqual({ claimed: true, runId: 11 });
  });

  it('returns claimed=false when rowCount is undefined and no rows are returned', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], undefined));

    await expect(claimScheduledJobRun('dream', 'daily:2026-04-26')).resolves.toEqual({ claimed: false, runId: null });
  });

  it('creates manual runs without a slot claim', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 9 }], 1));

    await expect(startManualJobRun('backup')).resolves.toEqual({ runId: 9 });
    expect(mockSql.mock.calls[0][1]).toEqual(['backup', 'manual', null, JSON.stringify({})]);
  });

  it('throws if manual run insert has invalid rowCount', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 9 }, { id: 10 }], 2));

    await expect(startManualJobRun('backup')).rejects.toThrow(
      'Failed to create manual job run for job "backup": expected rowCount 1, got 2',
    );
  });

  it('throws if manual run insert returns malformed row count', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 1));

    await expect(startManualJobRun('backup')).rejects.toThrow(
      'Failed to create manual job run for job "backup": expected one returned row, got 0',
    );
  });

  it('throws if manual run insert returns an invalid id', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 'not-a-number' }], 1));

    await expect(startManualJobRun('backup')).rejects.toThrow(
      'Failed to create manual job run for job "backup": invalid RETURNING id',
    );
  });

  it('marks runs as running', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 1));

    await markJobRunRunning(7);

    expect(mockSql.mock.calls[0][0]).toContain("status = 'running'");
    expect(mockSql.mock.calls[0][1]).toEqual([7]);
  });

  it('throws if mark running did not update exactly one row', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 0));

    await expect(markJobRunRunning(7)).rejects.toThrow('Failed to mark job run 7 as running: no row updated');
  });

  it('throws if mark running updated multiple rows', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 2));

    await expect(markJobRunRunning(7)).rejects.toThrow('Failed to mark job run 7 as running: expected 1 updated row, got 2');
  });

  it('marks runs completed with duration', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 1));

    await completeJobRun(7, 1234, { ok: true });

    expect(mockSql.mock.calls[0][0]).toContain("status = 'completed'");
    expect(mockSql.mock.calls[0][1]).toEqual([7, 1234, JSON.stringify({ ok: true })]);
  });

  it('throws if complete did not update exactly one row', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 0));

    await expect(completeJobRun(7, 1234, { ok: true })).rejects.toThrow('Failed to complete job run 7: no row updated');
  });

  it('throws if complete updated multiple rows', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 2));

    await expect(completeJobRun(7, 1234, { ok: true })).rejects.toThrow(
      'Failed to complete job run 7: expected 1 updated row, got 2',
    );
  });

  it('marks runs failed with error text', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 1));

    await failJobRun(7, 1234, new Error('boom'));

    expect(mockSql.mock.calls[0][0]).toContain("status = 'error'");
    expect(mockSql.mock.calls[0][1]).toEqual([7, 1234, 'boom', JSON.stringify({})]);
  });

  it('throws if fail did not update exactly one row', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 0));

    await expect(failJobRun(7, 1234, new Error('boom'))).rejects.toThrow('Failed to fail job run 7: no row updated');
  });

  it('throws if fail updated multiple rows', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 2));

    await expect(failJobRun(7, 1234, new Error('boom'))).rejects.toThrow(
      'Failed to fail job run 7: expected 1 updated row, got 2',
    );
  });

  it('includes created_at index in migration SQL', () => {
    const migrationPath = fileURLToPath(new URL('../../../../migrations/002_create_job_runs.sql', import.meta.url));
    const sqlText = readFileSync(migrationPath, 'utf8');

    expect(sqlText).toContain('CREATE INDEX IF NOT EXISTS job_runs_created_idx');
    expect(sqlText).toContain('ON job_runs (created_at DESC);');
  });

  it('lists recent runs with optional job filter', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 1, job_id: 'dream', details: {} }]));

    const result = await listJobRuns({ job_id: 'dream', limit: 20 });

    expect(result).toHaveLength(1);
    expect(mockSql.mock.calls[0][1]).toEqual(['dream', 20]);
  });
});

# Internal Jobs Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize all scheduled maintenance jobs behind an internal jobs runtime with database-backed execution history for the future jobs status page.

**Architecture:** Add a focused `web/server/lore/jobs/` runtime that owns job registration, timezone slot calculation, database-backed scheduled claims, execution history, and listing APIs. Dream and Backup stop hand-rolling scheduler logic and register jobs through this runtime; `instrumentation.ts` becomes the only scheduler startup point.

**Tech Stack:** Next.js 16 route handlers, TypeScript, PostgreSQL via `pg`, existing `app_settings` config system, Vitest, existing SQL migration runner.

---

## File Structure

Create:
- `web/migrations/001_create_job_runs.sql` — creates `job_runs` table and indexes.
- `web/server/lore/jobs/types.ts` — shared job definition and run record types.
- `web/server/lore/jobs/schedule.ts` — timezone slot calculation and daily schedule helpers.
- `web/server/lore/jobs/history.ts` — SQL helpers for claim/start/complete/error/list job runs.
- `web/server/lore/jobs/registry.ts` — in-memory job registry, scheduled tick loop, manual run entrypoint, job listing.
- `web/server/lore/jobs/jobDefinitions.ts` — registers built-in `dream` and `backup` jobs.
- `web/server/lore/jobs/__tests__/schedule.test.ts` — schedule helper tests.
- `web/server/lore/jobs/__tests__/history.test.ts` — SQL claim/history tests.
- `web/server/lore/jobs/__tests__/registry.test.ts` — registry execution tests.
- `web/app/api/jobs/route.ts` — unified jobs API for future UI.
- `web/app/api/jobs/__tests__/route.test.ts` — jobs API tests.

Modify:
- `web/instrumentation.ts` — initialize the unified job registry after migrations.
- `web/app/api/browse/dream/route.ts` — remove scheduler side-effect import and route manual run through job runtime.
- `web/app/api/backup/route.ts` — route manual backup through job runtime.
- `web/server/lore/dream/dreamScheduler.ts` — remove duplicated scheduler implementation or replace with a compatibility re-export.
- `web/server/lore/ops/backupScheduler.ts` — remove duplicated scheduler implementation or replace with a compatibility re-export.
- `web/server/lore/dream/__tests__/dreamScheduler.test.ts` — delete or replace with registry/job tests.
- `web/server/lore/ops/__tests__/backupScheduler.test.ts` — delete or replace with registry/job tests.

Do not modify unrelated UI files in this plan. The future jobs status page will consume the API created here, but the page itself is out of scope.

---

## Task 1: Add `job_runs` migration

**Files:**
- Create: `web/migrations/001_create_job_runs.sql`

- [ ] **Step 1: Write the migration**

Create `web/migrations/001_create_job_runs.sql`:

```sql
CREATE TABLE IF NOT EXISTS job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  slot_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'running', 'completed', 'error', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_runs_unique_slot
  ON job_runs (job_id, slot_key)
  WHERE slot_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_runs_job_created_idx
  ON job_runs (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_runs_status_created_idx
  ON job_runs (status, created_at DESC);
```

- [ ] **Step 2: Verify migration file is discoverable**

Run:

```bash
npm --prefix web run typecheck
```

Expected: PASS. This does not execute SQL, but confirms no TypeScript changes have been introduced yet and the repository still typechecks.

- [ ] **Step 3: Commit**

```bash
git add web/migrations/001_create_job_runs.sql
git commit -m "feat: add job run history migration"
```

---

## Task 2: Add schedule helper with timezone-safe daily slots

**Files:**
- Create: `web/server/lore/jobs/types.ts`
- Create: `web/server/lore/jobs/schedule.ts`
- Test: `web/server/lore/jobs/__tests__/schedule.test.ts`

- [ ] **Step 1: Write the failing schedule tests**

Create `web/server/lore/jobs/__tests__/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getDailyScheduleSlot, shouldRunDailySchedule } from '../schedule';

describe('jobs schedule helpers', () => {
  it('uses the configured timezone date for a daily slot', () => {
    const slot = getDailyScheduleSlot(new Date('2026-04-25T19:00:07.335Z'), 'Asia/Shanghai');

    expect(slot).toEqual({ slotKey: 'daily:2026-04-26', date: '2026-04-26', hour: 3 });
  });

  it('matches only the configured local hour', () => {
    expect(shouldRunDailySchedule(new Date('2026-04-25T19:10:00.000Z'), 'Asia/Shanghai', 3)).toEqual({
      due: true,
      slotKey: 'daily:2026-04-26',
      date: '2026-04-26',
      hour: 3,
    });

    expect(shouldRunDailySchedule(new Date('2026-04-25T18:10:00.000Z'), 'Asia/Shanghai', 3)).toEqual({
      due: false,
      slotKey: 'daily:2026-04-26',
      date: '2026-04-26',
      hour: 2,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/schedule.test.ts --run
```

Expected: FAIL with module resolution errors because `web/server/lore/jobs/schedule.ts` does not exist.

- [ ] **Step 3: Add shared job types**

Create `web/server/lore/jobs/types.ts`:

```ts
export type JobTrigger = 'scheduled' | 'manual';
export type JobRunStatus = 'claimed' | 'running' | 'completed' | 'error' | 'skipped';

export interface DailyJobSchedule {
  type: 'daily';
  enabledKey: string;
  hourKey: string;
  timezoneKey: string;
  defaultHour: number;
  defaultTimezone?: string;
}

export interface JobRunContext {
  job_id: string;
  trigger: JobTrigger;
  run_id: number;
  slot_key: string | null;
}

export interface RegisteredJob {
  id: string;
  label: string;
  schedule: DailyJobSchedule;
  run: (context: JobRunContext) => Promise<unknown>;
}

export interface JobRunRecord {
  id: number;
  job_id: string;
  trigger: JobTrigger;
  slot_key: string | null;
  status: JobRunStatus;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  duration_ms: number | null;
  error: string | null;
  details: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
}
```

- [ ] **Step 4: Implement schedule helper**

Create `web/server/lore/jobs/schedule.ts`:

```ts
function getTimeZonePart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value || '';
}

export function getDailyScheduleSlot(now: Date, timeZone: string): { slotKey: string; date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const year = getTimeZonePart(parts, 'year');
  const month = getTimeZonePart(parts, 'month');
  const day = getTimeZonePart(parts, 'day');
  const hour = Number(getTimeZonePart(parts, 'hour'));
  const date = `${year}-${month}-${day}`;
  return { slotKey: `daily:${date}`, date, hour };
}

export function shouldRunDailySchedule(
  now: Date,
  timeZone: string,
  scheduleHour: number,
): { due: boolean; slotKey: string; date: string; hour: number } {
  const slot = getDailyScheduleSlot(now, timeZone);
  return { ...slot, due: slot.hour === scheduleHour };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/schedule.test.ts --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/server/lore/jobs/types.ts web/server/lore/jobs/schedule.ts web/server/lore/jobs/__tests__/schedule.test.ts
git commit -m "feat: add timezone-safe job schedule helpers"
```

---

## Task 3: Add job history and atomic claim SQL helpers

**Files:**
- Create: `web/server/lore/jobs/history.ts`
- Test: `web/server/lore/jobs/__tests__/history.test.ts`

- [ ] **Step 1: Write failing history tests**

Create `web/server/lore/jobs/__tests__/history.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));

import { sql } from '../../../db';
import { claimScheduledJobRun, completeJobRun, failJobRun, listJobRuns, startManualJobRun } from '../history';

const mockSql = vi.mocked(sql);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
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

  it('returns claimed=false when the scheduled slot already exists', async () => {
    mockSql.mockResolvedValueOnce(makeResult([], 0));

    await expect(claimScheduledJobRun('dream', 'daily:2026-04-26')).resolves.toEqual({ claimed: false, runId: null });
  });

  it('creates manual runs without a slot claim', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 9 }], 1));

    await expect(startManualJobRun('backup')).resolves.toEqual({ runId: 9 });
    expect(mockSql.mock.calls[0][1]).toEqual(['backup', 'manual', null, JSON.stringify({})]);
  });

  it('marks runs completed with duration', async () => {
    mockSql.mockResolvedValueOnce(makeResult());

    await completeJobRun(7, 1234, { ok: true });

    expect(mockSql.mock.calls[0][0]).toContain("status = 'completed'");
    expect(mockSql.mock.calls[0][1]).toEqual([7, 1234, JSON.stringify({ ok: true })]);
  });

  it('marks runs failed with error text', async () => {
    mockSql.mockResolvedValueOnce(makeResult());

    await failJobRun(7, 1234, new Error('boom'));

    expect(mockSql.mock.calls[0][0]).toContain("status = 'error'");
    expect(mockSql.mock.calls[0][1]).toEqual([7, 1234, 'boom', JSON.stringify({})]);
  });

  it('lists recent runs with optional job filter', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 1, job_id: 'dream', details: {} }]));

    const result = await listJobRuns({ job_id: 'dream', limit: 20 });

    expect(result).toHaveLength(1);
    expect(mockSql.mock.calls[0][1]).toEqual(['dream', 20]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/history.test.ts --run
```

Expected: FAIL because `web/server/lore/jobs/history.ts` does not exist.

- [ ] **Step 3: Implement history helpers**

Create `web/server/lore/jobs/history.ts`:

```ts
import { sql } from '../../db';
import type { JobRunRecord } from './types';

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
  const runId = Number(result.rows[0]?.id || 0);
  return runId ? { claimed: true, runId } : { claimed: false, runId: null };
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
  return { runId: Number(result.rows[0].id) };
}

export async function markJobRunRunning(runId: number): Promise<void> {
  await sql(
    `UPDATE job_runs
     SET status = 'running', started_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [runId],
  );
}

export async function completeJobRun(
  runId: number,
  durationMs: number,
  details: Record<string, unknown> = {},
): Promise<void> {
  await sql(
    `UPDATE job_runs
     SET status = 'completed', completed_at = NOW(), duration_ms = $2, details = details || $3::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [runId, durationMs, JSON.stringify(details)],
  );
}

export async function failJobRun(
  runId: number,
  durationMs: number,
  error: unknown,
  details: Record<string, unknown> = {},
): Promise<void> {
  await sql(
    `UPDATE job_runs
     SET status = 'error', completed_at = NOW(), duration_ms = $2, error = $3, details = details || $4::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [runId, durationMs, (error as Error)?.message || String(error), JSON.stringify(details)],
  );
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/history.test.ts --run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/server/lore/jobs/history.ts web/server/lore/jobs/__tests__/history.test.ts
git commit -m "feat: add job run history helpers"
```

---

## Task 4: Add job registry and unified execution pipeline

**Files:**
- Create: `web/server/lore/jobs/registry.ts`
- Test: `web/server/lore/jobs/__tests__/registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `web/server/lore/jobs/__tests__/registry.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/settings', () => ({ getSetting: vi.fn(), getSettings: vi.fn() }));
vi.mock('../history', () => ({
  claimScheduledJobRun: vi.fn(),
  completeJobRun: vi.fn(),
  failJobRun: vi.fn(),
  listJobRuns: vi.fn(),
  markJobRunRunning: vi.fn(),
  startManualJobRun: vi.fn(),
}));

import { getSetting, getSettings } from '../../config/settings';
import {
  claimScheduledJobRun,
  completeJobRun,
  failJobRun,
  markJobRunRunning,
  startManualJobRun,
} from '../history';
import { clearJobRegistryForTest, listRegisteredJobs, registerJob, runDueJobsForTest, runJobNow } from '../registry';

const mockGetSetting = vi.mocked(getSetting);
const mockGetSettings = vi.mocked(getSettings);
const mockClaimScheduledJobRun = vi.mocked(claimScheduledJobRun);
const mockStartManualJobRun = vi.mocked(startManualJobRun);
const mockMarkJobRunRunning = vi.mocked(markJobRunRunning);
const mockCompleteJobRun = vi.mocked(completeJobRun);
const mockFailJobRun = vi.mocked(failJobRun);

describe('job registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearJobRegistryForTest();
    mockGetSetting.mockResolvedValue(true as any);
    mockGetSettings.mockResolvedValue({ 'demo.hour': 3, 'demo.tz': 'Asia/Shanghai' } as any);
    mockClaimScheduledJobRun.mockResolvedValue({ claimed: true, runId: 11 });
    mockStartManualJobRun.mockResolvedValue({ runId: 12 });
  });

  it('lists registered jobs with schedule metadata', () => {
    registerJob({
      id: 'demo',
      label: 'Demo Job',
      schedule: { type: 'daily', enabledKey: 'demo.enabled', hourKey: 'demo.hour', timezoneKey: 'demo.tz', defaultHour: 3 },
      run: vi.fn(),
    });

    expect(listRegisteredJobs()).toEqual([
      expect.objectContaining({ id: 'demo', label: 'Demo Job', schedule: expect.objectContaining({ defaultHour: 3 }) }),
    ]);
  });

  it('runs a due scheduled job after claiming the slot', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    registerJob({
      id: 'demo',
      label: 'Demo Job',
      schedule: { type: 'daily', enabledKey: 'demo.enabled', hourKey: 'demo.hour', timezoneKey: 'demo.tz', defaultHour: 3 },
      run,
    });

    await runDueJobsForTest(new Date('2026-04-25T19:10:00.000Z'));

    expect(mockClaimScheduledJobRun).toHaveBeenCalledWith('demo', 'daily:2026-04-26', expect.objectContaining({ date: '2026-04-26', hour: 3 }));
    expect(mockMarkJobRunRunning).toHaveBeenCalledWith(11);
    expect(run).toHaveBeenCalledWith({ job_id: 'demo', trigger: 'scheduled', run_id: 11, slot_key: 'daily:2026-04-26' });
    expect(mockCompleteJobRun).toHaveBeenCalledWith(11, expect.any(Number), { result: { ok: true } });
  });

  it('does not run when scheduled claim fails', async () => {
    const run = vi.fn();
    mockClaimScheduledJobRun.mockResolvedValue({ claimed: false, runId: null });
    registerJob({
      id: 'demo',
      label: 'Demo Job',
      schedule: { type: 'daily', enabledKey: 'demo.enabled', hourKey: 'demo.hour', timezoneKey: 'demo.tz', defaultHour: 3 },
      run,
    });

    await runDueJobsForTest(new Date('2026-04-25T19:10:00.000Z'));

    expect(run).not.toHaveBeenCalled();
  });

  it('runs manual jobs without consuming a scheduled slot', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    registerJob({
      id: 'demo',
      label: 'Demo Job',
      schedule: { type: 'daily', enabledKey: 'demo.enabled', hourKey: 'demo.hour', timezoneKey: 'demo.tz', defaultHour: 3 },
      run,
    });

    const result = await runJobNow('demo');

    expect(mockStartManualJobRun).toHaveBeenCalledWith('demo', {});
    expect(run).toHaveBeenCalledWith({ job_id: 'demo', trigger: 'manual', run_id: 12, slot_key: null });
    expect(result).toEqual({ job_id: 'demo', run_id: 12, result: { ok: true } });
  });

  it('records errors from job execution', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    registerJob({
      id: 'demo',
      label: 'Demo Job',
      schedule: { type: 'daily', enabledKey: 'demo.enabled', hourKey: 'demo.hour', timezoneKey: 'demo.tz', defaultHour: 3 },
      run,
    });

    await expect(runJobNow('demo')).rejects.toThrow('boom');
    expect(mockFailJobRun).toHaveBeenCalledWith(12, expect.any(Number), expect.any(Error));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/registry.test.ts --run
```

Expected: FAIL because `web/server/lore/jobs/registry.ts` does not exist.

- [ ] **Step 3: Implement registry**

Create `web/server/lore/jobs/registry.ts`:

```ts
import { getSetting, getSettings } from '../config/settings';
import {
  claimScheduledJobRun,
  completeJobRun,
  failJobRun,
  listJobRuns,
  markJobRunRunning,
  startManualJobRun,
} from './history';
import { shouldRunDailySchedule } from './schedule';
import type { JobRunContext, JobRunRecord, RegisteredJob } from './types';

const CHECK_INTERVAL_MS = 60_000;
const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const jobs = new Map<string, RegisteredJob>();

declare let globalThis: { __loreJobsScheduler?: boolean } & typeof global;

export function registerJob(job: RegisteredJob): void {
  if (jobs.has(job.id)) {
    throw new Error(`Job already registered: ${job.id}`);
  }
  jobs.set(job.id, job);
}

export function listRegisteredJobs(): RegisteredJob[] {
  return Array.from(jobs.values());
}

async function executeJob(job: RegisteredJob, context: JobRunContext): Promise<unknown> {
  const startedAt = Date.now();
  await markJobRunRunning(context.run_id);
  try {
    const result = await job.run(context);
    await completeJobRun(context.run_id, Date.now() - startedAt, { result });
    return result;
  } catch (error) {
    await failJobRun(context.run_id, Date.now() - startedAt, error);
    throw error;
  }
}

async function runDueJob(job: RegisteredJob, now: Date): Promise<void> {
  const enabled = await getSetting(job.schedule.enabledKey);
  if (enabled === false || enabled === 'false') return;

  const settings = await getSettings([job.schedule.hourKey, job.schedule.timezoneKey]);
  const scheduleHour = Number(settings[job.schedule.hourKey] ?? job.schedule.defaultHour);
  const timeZone = String(settings[job.schedule.timezoneKey] || job.schedule.defaultTimezone || DEFAULT_TIMEZONE);
  const slot = shouldRunDailySchedule(now, timeZone, scheduleHour);
  if (!slot.due) return;

  const claim = await claimScheduledJobRun(job.id, slot.slotKey, {
    date: slot.date,
    hour: slot.hour,
    timezone: timeZone,
  });
  if (!claim.claimed || !claim.runId) return;

  console.log(`[jobs] starting scheduled job ${job.id} ${slot.slotKey}`);
  await executeJob(job, { job_id: job.id, trigger: 'scheduled', run_id: claim.runId, slot_key: slot.slotKey });
  console.log(`[jobs] scheduled job ${job.id} completed`);
}

async function runDueJobs(now = new Date()): Promise<void> {
  for (const job of jobs.values()) {
    try {
      await runDueJob(job, now);
    } catch (error) {
      console.error(`[jobs] scheduled job ${job.id} failed`, (error as Error).message);
    }
  }
}

export async function runJobNow(jobId: string): Promise<{ job_id: string; run_id: number; result: unknown }> {
  const job = jobs.get(jobId);
  if (!job) {
    const error = new Error(`Unknown job: ${jobId}`) as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  const manual = await startManualJobRun(job.id, {});
  const result = await executeJob(job, { job_id: job.id, trigger: 'manual', run_id: manual.runId, slot_key: null });
  return { job_id: job.id, run_id: manual.runId, result };
}

export async function listJobsWithRuns(): Promise<{ jobs: RegisteredJob[]; recent_runs: JobRunRecord[] }> {
  return {
    jobs: listRegisteredJobs(),
    recent_runs: await listJobRuns({ limit: 50 }),
  };
}

export function initJobScheduler(): void {
  if (globalThis.__loreJobsScheduler) return;
  globalThis.__loreJobsScheduler = true;
  setInterval(() => void runDueJobs(), CHECK_INTERVAL_MS);
  console.log(`[jobs] initialized, checking every ${CHECK_INTERVAL_MS / 1000}s`);
}

export const runDueJobsForTest = runDueJobs;

export function clearJobRegistryForTest(): void {
  jobs.clear();
  globalThis.__loreJobsScheduler = false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/registry.test.ts --run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/server/lore/jobs/registry.ts web/server/lore/jobs/__tests__/registry.test.ts
git commit -m "feat: add internal job registry"
```

---

## Task 5: Register Dream and Backup as standard jobs

**Files:**
- Create: `web/server/lore/jobs/jobDefinitions.ts`
- Modify: `web/instrumentation.ts`
- Modify: `web/server/lore/dream/dreamScheduler.ts`
- Modify: `web/server/lore/ops/backupScheduler.ts`
- Test: `web/server/lore/jobs/__tests__/jobDefinitions.test.ts`

- [ ] **Step 1: Write failing job definition tests**

Create `web/server/lore/jobs/__tests__/jobDefinitions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../dream/dreamDiary', () => ({ runDream: vi.fn().mockResolvedValue({ id: 1 }) }));
vi.mock('../../ops/backup', () => ({
  exportToLocal: vi.fn().mockResolvedValue({ filename: 'backup.json' }),
  exportToWebDAV: vi.fn().mockResolvedValue({ filename: 'remote.json' }),
  cleanupLocalBackups: vi.fn().mockResolvedValue(undefined),
  cleanupWebDAVBackups: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../config/settings', () => ({ getSettings: vi.fn() }));

import { getSettings } from '../../config/settings';
import { runDream } from '../../dream/dreamDiary';
import { cleanupLocalBackups, exportToLocal } from '../../ops/backup';
import { clearJobRegistryForTest, listRegisteredJobs } from '../registry';
import { registerBuiltInJobs } from '../jobDefinitions';

const mockGetSettings = vi.mocked(getSettings);
const mockRunDream = vi.mocked(runDream);
const mockExportToLocal = vi.mocked(exportToLocal);
const mockCleanupLocalBackups = vi.mocked(cleanupLocalBackups);

describe('built-in job definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearJobRegistryForTest();
    mockGetSettings.mockResolvedValue({
      'backup.local.enabled': true,
      'backup.webdav.enabled': false,
      'backup.retention_count': 7,
    } as any);
  });

  it('registers dream and backup jobs', () => {
    registerBuiltInJobs();

    expect(listRegisteredJobs().map((job) => job.id)).toEqual(['dream', 'backup']);
  });

  it('dream job delegates to runDream', async () => {
    registerBuiltInJobs();
    const dream = listRegisteredJobs().find((job) => job.id === 'dream')!;

    await dream.run({ job_id: 'dream', trigger: 'scheduled', run_id: 1, slot_key: 'daily:2026-04-26' });

    expect(mockRunDream).toHaveBeenCalledTimes(1);
  });

  it('backup job runs configured local backup and cleanup', async () => {
    registerBuiltInJobs();
    const backup = listRegisteredJobs().find((job) => job.id === 'backup')!;

    await backup.run({ job_id: 'backup', trigger: 'scheduled', run_id: 2, slot_key: 'daily:2026-04-26' });

    expect(mockExportToLocal).toHaveBeenCalledTimes(1);
    expect(mockCleanupLocalBackups).toHaveBeenCalledWith(7);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/jobDefinitions.test.ts --run
```

Expected: FAIL because `jobDefinitions.ts` does not exist.

- [ ] **Step 3: Implement built-in job definitions**

Create `web/server/lore/jobs/jobDefinitions.ts`:

```ts
import { getSettings } from '../config/settings';
import { runDream } from '../dream/dreamDiary';
import { cleanupLocalBackups, cleanupWebDAVBackups, exportToLocal, exportToWebDAV } from '../ops/backup';
import { registerJob } from './registry';

let registered = false;

export function registerBuiltInJobs(): void {
  if (registered) return;
  registered = true;

  registerJob({
    id: 'dream',
    label: 'Dream memory consolidation',
    schedule: {
      type: 'daily',
      enabledKey: 'dream.enabled',
      hourKey: 'dream.schedule_hour',
      timezoneKey: 'dream.timezone',
      defaultHour: 3,
      defaultTimezone: 'Asia/Shanghai',
    },
    run: async () => runDream(),
  });

  registerJob({
    id: 'backup',
    label: 'Database backup',
    schedule: {
      type: 'daily',
      enabledKey: 'backup.enabled',
      hourKey: 'backup.schedule_hour',
      timezoneKey: 'backup.timezone',
      defaultHour: 4,
      defaultTimezone: 'Asia/Shanghai',
    },
    run: async () => {
      const cfg = await getSettings([
        'backup.local.enabled', 'backup.webdav.enabled', 'backup.retention_count',
      ]);
      const retention = Number(cfg['backup.retention_count']) || 7;
      const results: Record<string, unknown> = {};

      if (cfg['backup.local.enabled'] !== false) {
        results.local = await exportToLocal();
        await cleanupLocalBackups(retention);
      }
      if (cfg['backup.webdav.enabled'] === true) {
        results.webdav = await exportToWebDAV();
        await cleanupWebDAVBackups(retention);
      }

      return results;
    },
  });
}

export function clearBuiltInJobsForTest(): void {
  registered = false;
}
```

- [ ] **Step 4: Update instrumentation startup**

Modify `web/instrumentation.ts` to:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('./server/lore/ops/migrations');
    await runMigrations();
    const { registerBuiltInJobs } = await import('./server/lore/jobs/jobDefinitions');
    const { initJobScheduler } = await import('./server/lore/jobs/registry');
    registerBuiltInJobs();
    initJobScheduler();
  }
}
```

- [ ] **Step 5: Replace old scheduler modules with compatibility wrappers**

Modify `web/server/lore/dream/dreamScheduler.ts` to:

```ts
import { registerBuiltInJobs } from '../jobs/jobDefinitions';
import { initJobScheduler } from '../jobs/registry';

export function initDreamScheduler(): void {
  registerBuiltInJobs();
  initJobScheduler();
}
```

Modify `web/server/lore/ops/backupScheduler.ts` to:

```ts
import { registerBuiltInJobs } from '../jobs/jobDefinitions';
import { initJobScheduler } from '../jobs/registry';

export function initBackupScheduler(): void {
  registerBuiltInJobs();
  initJobScheduler();
}
```

- [ ] **Step 6: Run job definition tests**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/jobDefinitions.test.ts --run
```

Expected: PASS.

- [ ] **Step 7: Run legacy scheduler tests and remove obsolete expectations**

Run:

```bash
npm --prefix web run test:watch -- server/lore/dream/__tests__/dreamScheduler.test.ts server/lore/ops/__tests__/backupScheduler.test.ts --run
```

Expected: FAIL because the old test-only exports no longer exist. Delete both obsolete files:

```bash
rm "web/server/lore/dream/__tests__/dreamScheduler.test.ts" "web/server/lore/ops/__tests__/backupScheduler.test.ts"
```

The replacement coverage now lives in `web/server/lore/jobs/__tests__/schedule.test.ts`, `history.test.ts`, `registry.test.ts`, and `jobDefinitions.test.ts`.

- [ ] **Step 8: Run replacement job tests**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/schedule.test.ts server/lore/jobs/__tests__/history.test.ts server/lore/jobs/__tests__/registry.test.ts server/lore/jobs/__tests__/jobDefinitions.test.ts --run
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/server/lore/jobs/jobDefinitions.ts web/server/lore/jobs/__tests__/jobDefinitions.test.ts web/instrumentation.ts web/server/lore/dream/dreamScheduler.ts web/server/lore/ops/backupScheduler.ts
git rm web/server/lore/dream/__tests__/dreamScheduler.test.ts web/server/lore/ops/__tests__/backupScheduler.test.ts
git commit -m "feat: register built-in scheduled jobs"
```

---

## Task 6: Route manual Dream and Backup runs through the job runtime

**Files:**
- Modify: `web/app/api/browse/dream/route.ts`
- Modify: `web/app/api/backup/route.ts`
- Test: `web/app/api/browse/dream/__tests__/route.test.ts`
- Test: `web/app/api/backup/__tests__/route.test.ts`

- [ ] **Step 1: Inspect existing API route tests**

Run:

```bash
npm --prefix web run test:watch -- app/api/browse/dream/__tests__/route.test.ts --run
```

Expected: PASS before edits. If it fails before any edits, stop and inspect the failure before continuing.

- [ ] **Step 2: Write or update Dream route test for job runtime manual run**

Modify `web/app/api/browse/dream/__tests__/route.test.ts` to mock `runJobNow` from `server/lore/jobs/registry` and assert default POST calls `runJobNow('dream')` instead of `runDream()`.

Add this mock near existing mocks:

```ts
vi.mock('../../../../../server/lore/jobs/registry', () => ({ runJobNow: vi.fn() }));
```

Add import near existing imports:

```ts
import { runJobNow } from '../../../../../server/lore/jobs/registry';
```

Add this test in the POST describe block:

```ts
it('routes manual dream runs through the job runtime', async () => {
  vi.mocked(runJobNow).mockResolvedValueOnce({ job_id: 'dream', run_id: 42, result: { id: 7, status: 'completed' } } as any);

  const response = await POST(new Request('http://localhost/api/browse/dream', {
    method: 'POST',
    headers: { authorization: 'Bearer test' },
    body: JSON.stringify({ action: 'run' }),
  }) as any);
  const body = await response.json();

  expect(runJobNow).toHaveBeenCalledWith('dream');
  expect(body).toEqual({ id: 7, status: 'completed' });
});
```

- [ ] **Step 3: Run Dream route test to verify it fails**

Run:

```bash
npm --prefix web run test:watch -- app/api/browse/dream/__tests__/route.test.ts --run
```

Expected: FAIL because route still calls `runDream()` directly.

- [ ] **Step 4: Update Dream route**

Modify `web/app/api/browse/dream/route.ts`:

- Remove `initDreamScheduler` import and `initDreamScheduler();` side effect.
- Keep existing `runDream` import only if tests or other code still need it; otherwise remove it.
- Replace default POST body with:

```ts
    // Default: run dream
    const { runJobNow } = await import('../../../../server/lore/jobs/registry');
    const result = await runJobNow('dream');
    return NextResponse.json(result.result);
```

- [ ] **Step 5: Run Dream route test to verify it passes**

Run:

```bash
npm --prefix web run test:watch -- app/api/browse/dream/__tests__/route.test.ts --run
```

Expected: PASS.

- [ ] **Step 6: Create Backup route tests if missing**

If `web/app/api/backup/__tests__/route.test.ts` does not exist, create it with:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../../server/auth', () => ({ requireBearerAuth: vi.fn(() => null) }));
vi.mock('../../../../server/lore/jobs/registry', () => ({ runJobNow: vi.fn() }));
vi.mock('../../../../server/lore/ops/backup', () => ({
  restoreDatabase: vi.fn(),
  readLocalBackup: vi.fn(),
  exportDatabase: vi.fn(),
  listLocalBackups: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../../server/lore/config/settings', () => ({ getSetting: vi.fn().mockResolvedValue(false), getSettings: vi.fn() }));
vi.mock('../../../../server/db', () => ({ sql: vi.fn().mockResolvedValue({ rows: [] }) }));

import { POST } from '../route';
import { runJobNow } from '../../../../server/lore/jobs/registry';

const mockRunJobNow = vi.mocked(runJobNow);

describe('/api/backup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes manual backup runs through the job runtime', async () => {
    mockRunJobNow.mockResolvedValueOnce({ job_id: 'backup', run_id: 43, result: { local: { filename: 'backup.json' } } } as any);

    const response = await POST(new Request('http://localhost/api/backup', {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      body: JSON.stringify({ action: 'backup' }),
    }) as any);
    const body = await response.json();

    expect(mockRunJobNow).toHaveBeenCalledWith('backup');
    expect(body).toEqual({ results: { local: { filename: 'backup.json' } } });
  });
});
```

If the file exists, add the same mock/import/test to it instead of creating a duplicate.

- [ ] **Step 7: Run Backup route test to verify it fails**

Run:

```bash
npm --prefix web run test:watch -- app/api/backup/__tests__/route.test.ts --run
```

Expected: FAIL because route still executes backup functions directly.

- [ ] **Step 8: Update Backup route**

Modify default branch in `web/app/api/backup/route.ts` to:

```ts
    // Default: run backup
    const { runJobNow } = await import('../../../server/lore/jobs/registry');
    const result = await runJobNow('backup');
    return NextResponse.json({ results: result.result });
```

Remove now-unused default-branch imports of `exportToLocal`, `exportToWebDAV`, `cleanupLocalBackups`, `cleanupWebDAVBackups`, and `getSettings` from that branch.

- [ ] **Step 9: Run route tests to verify they pass**

Run:

```bash
npm --prefix web run test:watch -- app/api/browse/dream/__tests__/route.test.ts app/api/backup/__tests__/route.test.ts --run
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add web/app/api/browse/dream/route.ts web/app/api/browse/dream/__tests__/route.test.ts web/app/api/backup/route.ts web/app/api/backup/__tests__/route.test.ts
git commit -m "feat: route manual jobs through runtime"
```

---

## Task 7: Add unified jobs API for the future status page

**Files:**
- Create: `web/app/api/jobs/route.ts`
- Test: `web/app/api/jobs/__tests__/route.test.ts`

- [ ] **Step 1: Write failing jobs API tests**

Create `web/app/api/jobs/__tests__/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../server/auth', () => ({ requireBearerAuth: vi.fn(() => null) }));
vi.mock('../../../server/lore/jobs/registry', () => ({
  listRegisteredJobs: vi.fn(),
  runJobNow: vi.fn(),
}));
vi.mock('../../../server/lore/jobs/history', () => ({ listJobRuns: vi.fn() }));

import { GET, POST } from '../route';
import { listJobRuns } from '../../../server/lore/jobs/history';
import { listRegisteredJobs, runJobNow } from '../../../server/lore/jobs/registry';

const mockListRegisteredJobs = vi.mocked(listRegisteredJobs);
const mockListJobRuns = vi.mocked(listJobRuns);
const mockRunJobNow = vi.mocked(runJobNow);

describe('/api/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRegisteredJobs.mockReturnValue([
      { id: 'dream', label: 'Dream memory consolidation', schedule: { type: 'daily', enabledKey: 'dream.enabled', hourKey: 'dream.schedule_hour', timezoneKey: 'dream.timezone', defaultHour: 3 }, run: vi.fn() },
    ] as any);
    mockListJobRuns.mockResolvedValue([{ id: 1, job_id: 'dream', status: 'completed', details: {} }] as any);
  });

  it('returns registered jobs and recent runs', async () => {
    const response = await GET(new Request('http://localhost/api/jobs', { headers: { authorization: 'Bearer test' } }) as any);
    const body = await response.json();

    expect(body.jobs[0].id).toBe('dream');
    expect(body.jobs[0].run).toBeUndefined();
    expect(body.recent_runs[0].job_id).toBe('dream');
  });

  it('filters runs by job_id', async () => {
    await GET(new Request('http://localhost/api/jobs?job_id=dream&limit=20', { headers: { authorization: 'Bearer test' } }) as any);

    expect(mockListJobRuns).toHaveBeenCalledWith({ job_id: 'dream', limit: 20 });
  });

  it('runs a job manually', async () => {
    mockRunJobNow.mockResolvedValueOnce({ job_id: 'dream', run_id: 2, result: { id: 9 } });

    const response = await POST(new Request('http://localhost/api/jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      body: JSON.stringify({ job_id: 'dream' }),
    }) as any);
    const body = await response.json();

    expect(mockRunJobNow).toHaveBeenCalledWith('dream');
    expect(body.run_id).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm --prefix web run test:watch -- app/api/jobs/__tests__/route.test.ts --run
```

Expected: FAIL because `web/app/api/jobs/route.ts` does not exist.

- [ ] **Step 3: Implement jobs API route**

Create `web/app/api/jobs/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeJob(job: any) {
  const { run: _run, ...rest } = job;
  return rest;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const job_id = searchParams.get('job_id') || undefined;
    const limit = Number(searchParams.get('limit') || 50);
    const { listRegisteredJobs } = await import('../../server/lore/jobs/registry');
    const { listJobRuns } = await import('../../server/lore/jobs/history');
    const jobs = listRegisteredJobs().map(serializeJob);
    const recent_runs = await listJobRuns({ job_id, limit });
    return NextResponse.json({ jobs, recent_runs });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Jobs API failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({}));
    const jobId = String(body.job_id || '').trim();
    if (!jobId) return NextResponse.json({ detail: 'Missing job_id' }, { status: 400 });
    const { runJobNow } = await import('../../server/lore/jobs/registry');
    return NextResponse.json(await runJobNow(jobId));
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Job run failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
```

- [ ] **Step 4: Run jobs API tests to verify they pass**

Run:

```bash
npm --prefix web run test:watch -- app/api/jobs/__tests__/route.test.ts --run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/jobs/route.ts web/app/api/jobs/__tests__/route.test.ts
git commit -m "feat: add jobs status API"
```

---

## Task 8: Preserve legacy last_run_date status fields

**Files:**
- Modify: `web/server/lore/jobs/jobDefinitions.ts`
- Test: `web/server/lore/jobs/__tests__/jobDefinitions.test.ts`

- [ ] **Step 1: Add failing test for legacy last_run_date updates**

Modify `web/server/lore/jobs/__tests__/jobDefinitions.test.ts` to mock `sql`:

```ts
vi.mock('../../../db', () => ({ sql: vi.fn() }));
```

Add import:

```ts
import { sql } from '../../../db';
const mockSql = vi.mocked(sql);
```

Add this test:

```ts
it('updates legacy last_run_date after scheduled dream success', async () => {
  mockSql.mockResolvedValue({ rows: [], rowCount: 0 } as any);
  registerBuiltInJobs();
  const dream = listRegisteredJobs().find((job) => job.id === 'dream')!;

  await dream.run({ job_id: 'dream', trigger: 'scheduled', run_id: 1, slot_key: 'daily:2026-04-26' });

  expect(mockSql).toHaveBeenCalledWith(
    expect.stringContaining("VALUES ('dream.last_run_date'"),
    [JSON.stringify({ value: '2026-04-26' })],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/jobDefinitions.test.ts --run
```

Expected: FAIL because `jobDefinitions.ts` does not update legacy `*.last_run_date`.

- [ ] **Step 3: Implement legacy status update helper**

Modify `web/server/lore/jobs/jobDefinitions.ts`:

Add import:

```ts
import { sql } from '../../db';
import type { JobRunContext } from './types';
```

Add helper:

```ts
async function updateLegacyLastRunDate(key: string, context: JobRunContext): Promise<void> {
  if (context.trigger !== 'scheduled' || !context.slot_key?.startsWith('daily:')) return;
  const date = context.slot_key.slice('daily:'.length);
  await sql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify({ value: date })],
  );
}
```

Change Dream job run function to accept context:

```ts
    run: async (context) => {
      const result = await runDream();
      await updateLegacyLastRunDate('dream.last_run_date', context);
      return result;
    },
```

Change Backup job run function to accept context and update before returning:

```ts
    run: async (context) => {
      const cfg = await getSettings([
        'backup.local.enabled', 'backup.webdav.enabled', 'backup.retention_count',
      ]);
      const retention = Number(cfg['backup.retention_count']) || 7;
      const results: Record<string, unknown> = {};

      if (cfg['backup.local.enabled'] !== false) {
        results.local = await exportToLocal();
        await cleanupLocalBackups(retention);
      }
      if (cfg['backup.webdav.enabled'] === true) {
        results.webdav = await exportToWebDAV();
        await cleanupWebDAVBackups(retention);
      }

      await updateLegacyLastRunDate('backup.last_run_date', context);
      return results;
    },
```

- [ ] **Step 4: Fix expected SQL parameters in test**

Because helper uses `$1` for key, update the test expectation to:

```ts
  expect(mockSql).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO app_settings'),
    ['dream.last_run_date', JSON.stringify({ value: '2026-04-26' })],
  );
```

- [ ] **Step 5: Run job definition tests**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/jobDefinitions.test.ts --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/server/lore/jobs/jobDefinitions.ts web/server/lore/jobs/__tests__/jobDefinitions.test.ts
git commit -m "fix: preserve legacy scheduled job status"
```

---

## Task 9: Full verification and cleanup

**Files:**
- Verify all files touched by prior tasks.

- [ ] **Step 1: Run focused jobs and route tests**

Run:

```bash
npm --prefix web run test:watch -- server/lore/jobs/__tests__/schedule.test.ts server/lore/jobs/__tests__/history.test.ts server/lore/jobs/__tests__/registry.test.ts server/lore/jobs/__tests__/jobDefinitions.test.ts app/api/jobs/__tests__/route.test.ts app/api/browse/dream/__tests__/route.test.ts app/api/backup/__tests__/route.test.ts server/lore/dream/__tests__/dreamDiary.test.ts server/lore/ops/__tests__/backup.test.ts --run
```

Expected: all listed test files PASS.

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
npm --prefix web run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite if focused tests and typecheck pass**

Run:

```bash
npm --prefix web run test:watch -- --run
```

Expected: PASS. If this is too slow, record the focused tests and typecheck output before stopping.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git diff --stat
```

Expected: changes are limited to migrations, jobs runtime, scheduler wrappers, job-related API routes, and tests.

- [ ] **Step 5: Commit any remaining verification fixes**

If Step 1-4 required fixes, commit them:

```bash
git add web/migrations web/server/lore/jobs web/instrumentation.ts web/app/api/jobs web/app/api/browse/dream web/app/api/backup web/server/lore/dream/dreamScheduler.ts web/server/lore/ops/backupScheduler.ts
git commit -m "test: verify standardized jobs runtime"
```

If there are no remaining changes, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers internal standardization, future jobs page data via `job_runs`, Dream and Backup migration, `instrumentation.ts` startup, manual run behavior, scheduled run claim, legacy status preservation, and tests.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain. Each code-producing step includes concrete code.
- Type consistency: `job_id`, `slot_key`, `run_id`, `JobRunContext`, and `RegisteredJob` are consistently named across tasks.
- Scope check: The future UI page itself is intentionally out of scope; this plan creates the API and data model the page will use.

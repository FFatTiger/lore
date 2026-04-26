import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/settings', () => ({
  getSetting: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock('../schedule', () => ({
  shouldRunDailySchedule: vi.fn(),
}));

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
  listJobRuns,
  markJobRunRunning,
  startManualJobRun,
} from '../history';
import { shouldRunDailySchedule } from '../schedule';
import {
  clearJobRegistryForTest,
  initJobScheduler,
  listJobsWithRuns,
  listRegisteredJobs,
  registerJob,
  runDueJobsForTest,
  runJobNow,
} from '../registry';

const mockGetSetting = vi.mocked(getSetting);
const mockGetSettings = vi.mocked(getSettings);
const mockShouldRunDailySchedule = vi.mocked(shouldRunDailySchedule);
const mockClaimScheduledJobRun = vi.mocked(claimScheduledJobRun);
const mockCompleteJobRun = vi.mocked(completeJobRun);
const mockFailJobRun = vi.mocked(failJobRun);
const mockListJobRuns = vi.mocked(listJobRuns);
const mockMarkJobRunRunning = vi.mocked(markJobRunRunning);
const mockStartManualJobRun = vi.mocked(startManualJobRun);

function registerTestJob(
  run = vi.fn().mockResolvedValue({ ok: true }),
  id = 'dream',
  label = 'Dream',
) {
  registerJob({
    id,
    label,
    schedule: {
      type: 'daily',
      enabledKey: `${id}.enabled`,
      hourKey: `${id}.schedule_hour`,
      timezoneKey: `${id}.timezone`,
      defaultHour: 3,
      defaultTimezone: 'Asia/Shanghai',
    },
    run,
  });
  return run;
}

describe('job registry', () => {
  beforeEach(() => {
    clearJobRegistryForTest();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('registers and lists jobs in memory', () => {
    const run = registerTestJob();

    expect(listRegisteredJobs()).toEqual([
      expect.objectContaining({ id: 'dream', label: 'Dream', run }),
    ]);
  });

  it('runs due scheduled jobs through the history pipeline', async () => {
    const now = new Date('2026-04-25T19:10:00.000Z');
    const run = registerTestJob();
    mockGetSetting.mockResolvedValueOnce(true);
    mockGetSettings.mockResolvedValueOnce({
      'dream.schedule_hour': 3,
      'dream.timezone': 'Asia/Shanghai',
    });
    mockShouldRunDailySchedule.mockReturnValueOnce({ due: true, slotKey: 'daily:2026-04-26', date: '2026-04-26', hour: 3 });
    mockClaimScheduledJobRun.mockResolvedValueOnce({ claimed: true, runId: 11 });

    await runDueJobsForTest(now);

    expect(mockGetSetting).toHaveBeenCalledWith('dream.enabled');
    expect(mockGetSettings).toHaveBeenCalledWith(['dream.schedule_hour', 'dream.timezone']);
    expect(mockShouldRunDailySchedule).toHaveBeenCalledWith(now, 'Asia/Shanghai', 3);
    expect(mockClaimScheduledJobRun).toHaveBeenCalledWith('dream', 'daily:2026-04-26', { date: '2026-04-26', hour: 3 });
    expect(mockMarkJobRunRunning).toHaveBeenCalledWith(11);
    expect(run).toHaveBeenCalledWith({ job_id: 'dream', trigger: 'scheduled', run_id: 11, slot_key: 'daily:2026-04-26' });
    expect(mockCompleteJobRun).toHaveBeenCalledWith(11, expect.any(Number), { result: { ok: true } });
  });

  it('does not run a scheduled job when the slot claim fails', async () => {
    const run = registerTestJob();
    mockGetSetting.mockResolvedValueOnce(true);
    mockGetSettings.mockResolvedValueOnce({ 'dream.schedule_hour': 3, 'dream.timezone': 'Asia/Shanghai' });
    mockShouldRunDailySchedule.mockReturnValueOnce({ due: true, slotKey: 'daily:2026-04-26', date: '2026-04-26', hour: 3 });
    mockClaimScheduledJobRun.mockResolvedValueOnce({ claimed: false, runId: null });

    await runDueJobsForTest(new Date('2026-04-25T19:10:00.000Z'));

    expect(run).not.toHaveBeenCalled();
    expect(mockMarkJobRunRunning).not.toHaveBeenCalled();
  });

  it('skips scheduled jobs that are disabled or not due', async () => {
    const run = registerTestJob();
    mockGetSetting.mockResolvedValueOnce(false);

    await runDueJobsForTest(new Date('2026-04-25T19:10:00.000Z'));

    expect(run).not.toHaveBeenCalled();
    expect(mockGetSettings).not.toHaveBeenCalled();

    mockGetSetting.mockResolvedValueOnce(true);
    mockGetSettings.mockResolvedValueOnce({ 'dream.schedule_hour': 3, 'dream.timezone': 'Asia/Shanghai' });
    mockShouldRunDailySchedule.mockReturnValueOnce({ due: false, slotKey: 'daily:2026-04-26', date: '2026-04-26', hour: 2 });

    await runDueJobsForTest(new Date('2026-04-25T18:10:00.000Z'));

    expect(run).not.toHaveBeenCalled();
    expect(mockClaimScheduledJobRun).not.toHaveBeenCalled();
  });

  it('runs later due scheduled jobs when an earlier job setup step fails', async () => {
    const now = new Date('2026-04-25T19:10:00.000Z');
    const firstRun = registerTestJob(vi.fn(), 'dream', 'Dream');
    const secondRun = registerTestJob(vi.fn().mockResolvedValue({ ok: true }), 'backup', 'Backup');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockGetSetting.mockResolvedValue(true);
    mockGetSettings
      .mockRejectedValueOnce(new Error('settings unavailable'))
      .mockResolvedValueOnce({ 'backup.schedule_hour': 3, 'backup.timezone': 'Asia/Shanghai' });
    mockShouldRunDailySchedule.mockReturnValueOnce({ due: true, slotKey: 'daily:backup', date: '2026-04-26', hour: 3 });
    mockClaimScheduledJobRun.mockResolvedValueOnce({ claimed: true, runId: 12 });

    await runDueJobsForTest(now);

    expect(firstRun).not.toHaveBeenCalled();
    expect(secondRun).toHaveBeenCalledWith({ job_id: 'backup', trigger: 'scheduled', run_id: 12, slot_key: 'daily:backup' });
    expect(mockCompleteJobRun).toHaveBeenCalledWith(12, expect.any(Number), { result: { ok: true } });
    expect(consoleError).toHaveBeenCalledWith('[job-scheduler] job failed', 'dream', 'settings unavailable');
  });

  it('runs later due scheduled jobs when an earlier job fails', async () => {
    const now = new Date('2026-04-25T19:10:00.000Z');
    const error = new Error('first failed');
    const firstRun = registerTestJob(vi.fn().mockRejectedValue(error), 'dream', 'Dream');
    const secondRun = registerTestJob(vi.fn().mockResolvedValue({ ok: true }), 'backup', 'Backup');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockGetSetting.mockResolvedValue(true);
    mockGetSettings
      .mockResolvedValueOnce({ 'dream.schedule_hour': 3, 'dream.timezone': 'Asia/Shanghai' })
      .mockResolvedValueOnce({ 'backup.schedule_hour': 3, 'backup.timezone': 'Asia/Shanghai' });
    mockShouldRunDailySchedule
      .mockReturnValueOnce({ due: true, slotKey: 'daily:dream', date: '2026-04-26', hour: 3 })
      .mockReturnValueOnce({ due: true, slotKey: 'daily:backup', date: '2026-04-26', hour: 3 });
    mockClaimScheduledJobRun
      .mockResolvedValueOnce({ claimed: true, runId: 11 })
      .mockResolvedValueOnce({ claimed: true, runId: 12 });

    await runDueJobsForTest(now);

    expect(firstRun).toHaveBeenCalledWith({ job_id: 'dream', trigger: 'scheduled', run_id: 11, slot_key: 'daily:dream' });
    expect(secondRun).toHaveBeenCalledWith({ job_id: 'backup', trigger: 'scheduled', run_id: 12, slot_key: 'daily:backup' });
    expect(mockFailJobRun).toHaveBeenCalledWith(11, expect.any(Number), error);
    expect(mockCompleteJobRun).toHaveBeenCalledWith(12, expect.any(Number), { result: { ok: true } });
    expect(consoleError).toHaveBeenCalledWith('[job-scheduler] job failed', 'dream', 'first failed');
  });

  it('fails claimed runs when marking them running fails', async () => {
    const error = new Error('database unavailable');
    registerTestJob();
    mockStartManualJobRun.mockResolvedValueOnce({ runId: 41 });
    mockMarkJobRunRunning.mockRejectedValueOnce(error);

    await expect(runJobNow('dream')).rejects.toThrow('database unavailable');
    expect(mockFailJobRun).toHaveBeenCalledWith(41, expect.any(Number), error);
    expect(mockCompleteJobRun).not.toHaveBeenCalled();
  });

  it('persists JSON-safe fallback details for non-serializable job results', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    registerTestJob(vi.fn().mockResolvedValue(circular));
    mockStartManualJobRun.mockResolvedValueOnce({ runId: 51 });

    await expect(runJobNow('dream')).resolves.toEqual({ job_id: 'dream', run_id: 51, result: circular });
    expect(mockCompleteJobRun).toHaveBeenCalledWith(51, expect.any(Number), { result_type: 'object' });
  });

  it('persists JSON-safe fallback details for function job results', async () => {
    const result = () => 'not json';
    registerTestJob(vi.fn().mockResolvedValue(result));
    mockStartManualJobRun.mockResolvedValueOnce({ runId: 52 });

    await expect(runJobNow('dream')).resolves.toEqual({ job_id: 'dream', run_id: 52, result });
    expect(mockCompleteJobRun).toHaveBeenCalledWith(52, expect.any(Number), { result_type: 'function' });
  });

  it('starts a manual run and returns its result', async () => {
    registerTestJob(vi.fn().mockResolvedValue({ manual: true }));
    mockStartManualJobRun.mockResolvedValueOnce({ runId: 23 });

    await expect(runJobNow('dream')).resolves.toEqual({ job_id: 'dream', run_id: 23, result: { manual: true } });
    expect(mockMarkJobRunRunning).toHaveBeenCalledWith(23);
    expect(mockCompleteJobRun).toHaveBeenCalledWith(23, expect.any(Number), { result: { manual: true } });
  });

  it('throws status 404 for unknown manual jobs', async () => {
    await expect(runJobNow('missing')).rejects.toMatchObject({ status: 404, message: 'Unknown job: missing' });
    expect(mockStartManualJobRun).not.toHaveBeenCalled();
  });

  it('records failed job runs and rethrows the error', async () => {
    const error = new Error('boom');
    registerTestJob(vi.fn().mockRejectedValue(error));
    mockStartManualJobRun.mockResolvedValueOnce({ runId: 31 });

    await expect(runJobNow('dream')).rejects.toThrow('boom');
    expect(mockFailJobRun).toHaveBeenCalledWith(31, expect.any(Number), error);
    expect(mockCompleteJobRun).not.toHaveBeenCalled();
  });

  it('lists registered jobs with recent runs', async () => {
    registerTestJob();
    mockListJobRuns.mockResolvedValueOnce([{ id: 1, job_id: 'dream' } as any]);

    await expect(listJobsWithRuns()).resolves.toEqual({
      jobs: [expect.objectContaining({ id: 'dream', label: 'Dream' })],
      recent_runs: [{ id: 1, job_id: 'dream' }],
    });
    expect(mockListJobRuns).toHaveBeenCalledWith({ limit: 50 });
  });

  it('initializes the interval scheduler only once', () => {
    vi.useFakeTimers();
    const interval = vi.spyOn(globalThis, 'setInterval');

    initJobScheduler();
    initJobScheduler();

    expect(interval).toHaveBeenCalledTimes(1);
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db', () => ({
  sql: vi.fn(),
}));

vi.mock('../../dream/dreamDiary', () => ({
  runDream: vi.fn(),
}));

vi.mock('../../ops/backup', () => ({
  cleanupLocalBackups: vi.fn(),
  cleanupWebDAVBackups: vi.fn(),
  exportToLocal: vi.fn(),
  exportToWebDAV: vi.fn(),
}));

vi.mock('../../config/settings', () => ({
  getSettings: vi.fn(),
}));

import { sql } from '../../../db';
import { runDream } from '../../dream/dreamDiary';
import {
  cleanupLocalBackups,
  cleanupWebDAVBackups,
  exportToLocal,
  exportToWebDAV,
} from '../../ops/backup';
import { getSettings } from '../../config/settings';
import { clearJobRegistryForTest, listRegisteredJobs } from '../registry';
import { clearBuiltInJobsForTest, registerBuiltInJobs } from '../jobDefinitions';

const mockSql = vi.mocked(sql);
const mockRunDream = vi.mocked(runDream);
const mockExportToLocal = vi.mocked(exportToLocal);
const mockCleanupLocalBackups = vi.mocked(cleanupLocalBackups);
const mockExportToWebDAV = vi.mocked(exportToWebDAV);
const mockCleanupWebDAVBackups = vi.mocked(cleanupWebDAVBackups);
const mockGetSettings = vi.mocked(getSettings);

describe('built-in job definitions', () => {
  beforeEach(() => {
    clearBuiltInJobsForTest();
    clearJobRegistryForTest();
    vi.clearAllMocks();
  });

  it('registers dream and backup jobs in order with daily schedules', () => {
    registerBuiltInJobs();

    expect(listRegisteredJobs().map((job) => ({
      id: job.id,
      label: job.label,
      schedule: job.schedule,
    }))).toEqual([
      {
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
      },
      {
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
      },
    ]);
  });

  it('is idempotent when registering built-in jobs more than once', () => {
    registerBuiltInJobs();
    registerBuiltInJobs();

    expect(listRegisteredJobs().map((job) => job.id)).toEqual(['dream', 'backup']);
  });

  it('runs the dream job by delegating to runDream', async () => {
    mockRunDream.mockResolvedValueOnce({ diary_id: 10 });
    registerBuiltInJobs();

    const dreamJob = listRegisteredJobs()[0];
    const result = await dreamJob.run({ job_id: 'dream', trigger: 'manual', run_id: 1, slot_key: null });

    expect(mockRunDream).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ diary_id: 10 });
  });

  it('runs local backup and cleanup by default and returns results', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'backup.local.enabled': true,
      'backup.webdav.enabled': false,
      'backup.retention_count': 5,
    });
    mockExportToLocal.mockResolvedValueOnce({ filename: 'local.json', path: '/tmp/local.json', size: 10, stats: {} });
    mockCleanupLocalBackups.mockResolvedValueOnce(2);
    registerBuiltInJobs();

    const backupJob = listRegisteredJobs()[1];
    const result = await backupJob.run({ job_id: 'backup', trigger: 'manual', run_id: 2, slot_key: null });

    expect(mockGetSettings).toHaveBeenCalledWith([
      'backup.local.enabled',
      'backup.webdav.enabled',
      'backup.retention_count',
    ]);
    expect(mockExportToLocal).toHaveBeenCalledTimes(1);
    expect(mockCleanupLocalBackups).toHaveBeenCalledWith(5);
    expect(mockExportToWebDAV).not.toHaveBeenCalled();
    expect(mockCleanupWebDAVBackups).not.toHaveBeenCalled();
    expect(result).toEqual({
      local: { filename: 'local.json', path: '/tmp/local.json', size: 10, stats: {} },
    });
  });

  it('returns only webdav key when local backup is disabled and webdav is enabled', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'backup.local.enabled': false,
      'backup.webdav.enabled': true,
      'backup.retention_count': 3,
    });
    mockExportToWebDAV.mockResolvedValueOnce({ filename: 'remote.json', url: 'https://example.test/remote.json', size: 20, stats: {} });
    mockCleanupWebDAVBackups.mockResolvedValueOnce(4);
    registerBuiltInJobs();

    const backupJob = listRegisteredJobs()[1];
    const result = await backupJob.run({ job_id: 'backup', trigger: 'manual', run_id: 3, slot_key: null });

    expect(result).toEqual({
      webdav: { filename: 'remote.json', url: 'https://example.test/remote.json', size: 20, stats: {} },
    });
  });

  it('returns an empty object when local and webdav backups are disabled', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'backup.local.enabled': false,
      'backup.webdav.enabled': false,
      'backup.retention_count': 7,
    });
    registerBuiltInJobs();

    const backupJob = listRegisteredJobs()[1];
    const result = await backupJob.run({ job_id: 'backup', trigger: 'manual', run_id: 4, slot_key: null });

    expect(mockExportToLocal).not.toHaveBeenCalled();
    expect(mockExportToWebDAV).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('skips local backup when disabled and runs webdav only when enabled', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'backup.local.enabled': false,
      'backup.webdav.enabled': true,
      'backup.retention_count': 3,
    });
    mockExportToWebDAV.mockResolvedValueOnce({ filename: 'remote.json', url: 'https://example.test/remote.json', size: 20, stats: {} });
    mockCleanupWebDAVBackups.mockResolvedValueOnce(4);
    registerBuiltInJobs();

    const backupJob = listRegisteredJobs()[1];
    const result = await backupJob.run({ job_id: 'backup', trigger: 'manual', run_id: 3, slot_key: null });

    expect(mockExportToLocal).not.toHaveBeenCalled();
    expect(mockCleanupLocalBackups).not.toHaveBeenCalled();
    expect(mockExportToWebDAV).toHaveBeenCalledTimes(1);
    expect(mockCleanupWebDAVBackups).toHaveBeenCalledWith(3);
    expect(result).toEqual({
      webdav: { filename: 'remote.json', url: 'https://example.test/remote.json', size: 20, stats: {} },
    });
  });

  it('preserves legacy dream last_run_date for scheduled dream runs', async () => {
    mockRunDream.mockResolvedValueOnce({ diary_id: 11 });
    registerBuiltInJobs();

    const dreamJob = listRegisteredJobs()[0];
    const result = await dreamJob.run({ job_id: 'dream', trigger: 'scheduled', run_id: 6, slot_key: 'daily:2026-04-26' });

    expect(result).toEqual({ diary_id: 11 });
    expect(mockSql).toHaveBeenCalledWith(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      ['dream.last_run_date', JSON.stringify({ value: '2026-04-26' })],
    );
  });

  it('does not update legacy dream last_run_date for manual dream runs', async () => {
    mockRunDream.mockResolvedValueOnce({ diary_id: 12 });
    registerBuiltInJobs();

    const dreamJob = listRegisteredJobs()[0];
    await dreamJob.run({ job_id: 'dream', trigger: 'manual', run_id: 7, slot_key: null });

    expect(mockSql).not.toHaveBeenCalled();
  });

  it('preserves legacy backup last_run_date for scheduled backup runs', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'backup.local.enabled': false,
      'backup.webdav.enabled': false,
      'backup.retention_count': 7,
    });
    registerBuiltInJobs();

    const backupJob = listRegisteredJobs()[1];
    const result = await backupJob.run({ job_id: 'backup', trigger: 'scheduled', run_id: 4, slot_key: 'daily:2026-04-26' });

    expect(result).toEqual({});
    expect(mockSql).toHaveBeenCalledWith(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      ['backup.last_run_date', JSON.stringify({ value: '2026-04-26' })],
    );
  });

  it('does not update legacy backup last_run_date for manual backup runs', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'backup.local.enabled': false,
      'backup.webdav.enabled': false,
      'backup.retention_count': 7,
    });
    registerBuiltInJobs();

    const backupJob = listRegisteredJobs()[1];
    await backupJob.run({ job_id: 'backup', trigger: 'manual', run_id: 5, slot_key: null });

    expect(mockSql).not.toHaveBeenCalled();
  });

  it('does not fail scheduled dream run when legacy last_run_date update fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRunDream.mockResolvedValueOnce({ diary_id: 13 });
    mockSql.mockRejectedValueOnce(new Error('settings write failed'));
    registerBuiltInJobs();

    const dreamJob = listRegisteredJobs()[0];
    const result = await dreamJob.run({ job_id: 'dream', trigger: 'scheduled', run_id: 8, slot_key: 'daily:2026-04-26' });

    expect(result).toEqual({ diary_id: 13 });
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    consoleErrorSpy.mockRestore();
  });

  it('does not fail scheduled backup run when legacy last_run_date update fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetSettings.mockResolvedValueOnce({
      'backup.local.enabled': true,
      'backup.webdav.enabled': false,
      'backup.retention_count': 5,
    });
    mockExportToLocal.mockResolvedValueOnce({ filename: 'local.json', path: '/tmp/local.json', size: 10, stats: {} });
    mockCleanupLocalBackups.mockResolvedValueOnce(2);
    mockSql.mockRejectedValueOnce(new Error('settings write failed'));
    registerBuiltInJobs();

    const backupJob = listRegisteredJobs()[1];
    const result = await backupJob.run({ job_id: 'backup', trigger: 'scheduled', run_id: 9, slot_key: 'daily:2026-04-26' });

    expect(result).toEqual({
      local: { filename: 'local.json', path: '/tmp/local.json', size: 10, stats: {} },
    });
    expect(result).not.toHaveProperty('webdav');
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    consoleErrorSpy.mockRestore();
  });
});

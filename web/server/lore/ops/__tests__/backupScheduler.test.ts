import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../config/settings', () => ({
  getSetting: vi.fn(),
  getSettings: vi.fn(),
}));
vi.mock('../backup', () => ({
  exportToLocal: vi.fn(),
  exportToWebDAV: vi.fn(),
  cleanupLocalBackups: vi.fn(),
  cleanupWebDAVBackups: vi.fn(),
}));

import { sql } from '../../../db';
import { getSetting, getSettings } from '../../config/settings';
import { exportToLocal, cleanupLocalBackups } from '../backup';
import { _checkAndRunBackupForTest, _getBackupScheduleSlot } from '../backupScheduler';

const mockSql = vi.mocked(sql);
const mockGetSetting = vi.mocked(getSetting);
const mockGetSettings = vi.mocked(getSettings);
const mockExportToLocal = vi.mocked(exportToLocal);
const mockCleanupLocalBackups = vi.mocked(cleanupLocalBackups);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
}

describe('backupScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockResolvedValue(true as any);
    mockGetSettings.mockImplementation(async (keys: string[]) => {
      if (keys.includes('backup.schedule_hour')) {
        return { 'backup.schedule_hour': 4, 'backup.timezone': 'Asia/Shanghai' } as any;
      }
      return { 'backup.local.enabled': true, 'backup.webdav.enabled': false, 'backup.retention_count': 7 } as any;
    });
    mockExportToLocal.mockResolvedValue({ filename: 'backup.json' } as any);
    mockCleanupLocalBackups.mockResolvedValue(undefined as any);
  });

  it('uses the configured timezone date for the scheduled slot', () => {
    const slot = _getBackupScheduleSlot(new Date('2026-04-25T20:00:07.335Z'), 'Asia/Shanghai');

    expect(slot.hour).toBe(4);
    expect(slot.date).toBe('2026-04-26');
  });

  it('runs backup only when the database claim succeeds', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ value: { value: '2026-04-26' } }], 1))
      .mockResolvedValueOnce(makeResult([], 0));

    await _checkAndRunBackupForTest(new Date('2026-04-25T20:00:07.335Z'));
    await _checkAndRunBackupForTest(new Date('2026-04-25T20:00:07.335Z'));

    expect(mockSql).toHaveBeenCalledTimes(2);
    expect(mockSql.mock.calls[0][1]).toEqual([JSON.stringify({ value: '2026-04-26' }), '2026-04-26']);
    expect(mockExportToLocal).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../config/settings', () => ({
  getSetting: vi.fn(),
  getSettings: vi.fn(),
}));
vi.mock('../dreamDiary', () => ({ runDream: vi.fn() }));

import { sql } from '../../../db';
import { getSetting, getSettings } from '../../config/settings';
import { runDream } from '../dreamDiary';
import { _checkAndRunDreamForTest, _getDreamScheduleSlot } from '../dreamScheduler';

const mockSql = vi.mocked(sql);
const mockGetSetting = vi.mocked(getSetting);
const mockGetSettings = vi.mocked(getSettings);
const mockRunDream = vi.mocked(runDream);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
}

describe('dreamScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockResolvedValue(true as any);
    mockGetSettings.mockResolvedValue({ 'dream.schedule_hour': 3, 'dream.timezone': 'Asia/Shanghai' });
    mockRunDream.mockResolvedValue({ id: 1, status: 'completed' } as any);
  });

  it('uses the configured timezone date for the scheduled slot', () => {
    const slot = _getDreamScheduleSlot(new Date('2026-04-25T19:00:07.335Z'), 'Asia/Shanghai');

    expect(slot.hour).toBe(3);
    expect(slot.date).toBe('2026-04-26');
  });

  it('runs the dream only when the database claim succeeds', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ value: { value: '2026-04-26' } }], 1))
      .mockResolvedValueOnce(makeResult([], 0));

    await _checkAndRunDreamForTest(new Date('2026-04-25T19:00:07.335Z'));
    await _checkAndRunDreamForTest(new Date('2026-04-25T19:00:07.335Z'));

    expect(mockSql).toHaveBeenCalledTimes(2);
    expect(mockSql.mock.calls[0][1]).toEqual([JSON.stringify({ value: '2026-04-26' }), '2026-04-26']);
    expect(mockRunDream).toHaveBeenCalledTimes(1);
  });
});

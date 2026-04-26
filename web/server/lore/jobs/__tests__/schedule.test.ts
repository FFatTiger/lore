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

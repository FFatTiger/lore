import { sql } from '../../db';
import { getSetting, getSettings } from '../config/settings';

const CHECK_INTERVAL_MS = 60_000;

function getTimeZonePart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value || '';
}

export function _getDreamScheduleSlot(now: Date, timeZone: string): { date: string; hour: number } {
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
  return { date: `${year}-${month}-${day}`, hour };
}

async function claimDreamRun(date: string): Promise<boolean> {
  const result = await sql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('dream.last_run_date', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     WHERE COALESCE(app_settings.value->>'value', '') <> $2
     RETURNING value`,
    [JSON.stringify({ value: date }), date],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

async function checkAndRunDream(now = new Date()): Promise<void> {
  try {
    const enabled = await getSetting('dream.enabled');
    if (enabled === false) return;

    const s = await getSettings(['dream.schedule_hour', 'dream.timezone']);
    const scheduleHour = Number(s['dream.schedule_hour'] ?? 3);
    const tz = String(s['dream.timezone'] || 'Asia/Shanghai');

    const slot = _getDreamScheduleSlot(now, tz);
    if (slot.hour !== scheduleHour) return;
    if (!await claimDreamRun(slot.date)) return;

    console.log('[dream-scheduler] starting scheduled dream');
    const { runDream } = await import('./dreamDiary');
    await runDream();
    console.log('[dream-scheduler] scheduled dream completed');
  } catch (err: unknown) {
    console.error('[dream-scheduler] failed', (err as Error).message);
  }
}

export const _checkAndRunDreamForTest = checkAndRunDream;

declare let globalThis: { __loreDreamScheduler?: boolean } & typeof global;

export function initDreamScheduler(): void {
  if (globalThis.__loreDreamScheduler) return;
  globalThis.__loreDreamScheduler = true;
  setInterval(checkAndRunDream, CHECK_INTERVAL_MS);
  console.log(`[dream-scheduler] initialized, checking every ${CHECK_INTERVAL_MS / 1000}s`);
}

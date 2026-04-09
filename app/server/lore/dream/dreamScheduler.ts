import { sql } from '../../db';
import { getSetting, getSettings } from '../config/settings';

const CHECK_INTERVAL_MS = 60_000;

async function checkAndRunDream(): Promise<void> {
  try {
    const enabled = await getSetting('dream.enabled');
    if (enabled === false) return;

    const s = await getSettings(['dream.schedule_hour', 'dream.timezone']);
    const scheduleHour = Number(s['dream.schedule_hour'] ?? 3);
    const tz = String(s['dream.timezone'] || 'Asia/Shanghai');

    const now = new Date();
    const localTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const currentHour = localTime.getHours();
    if (currentHour !== scheduleHour) return;

    const today = localTime.toISOString().slice(0, 10);
    let lastRunDate: string | null = null;
    try {
      const r = await sql(`SELECT value FROM app_settings WHERE key = 'dream.last_run_date'`);
      lastRunDate = (r.rows[0]?.value as Record<string, unknown>)?.value as string || null;
    } catch { /* ignore */ }
    if (lastRunDate === today) return;

    // Mark today before running to prevent double-execution
    await sql(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('dream.last_run_date', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify({ value: today })],
    );

    console.log('[dream-scheduler] starting scheduled dream');
    const { runDream } = await import('./dreamDiary');
    await runDream();
    console.log('[dream-scheduler] scheduled dream completed');
  } catch (err: unknown) {
    console.error('[dream-scheduler] failed', (err as Error).message);
  }
}

declare let globalThis: { __loreDreamScheduler?: boolean } & typeof global;

export function initDreamScheduler(): void {
  if (globalThis.__loreDreamScheduler) return;
  globalThis.__loreDreamScheduler = true;
  setInterval(checkAndRunDream, CHECK_INTERVAL_MS);
  console.log(`[dream-scheduler] initialized, checking every ${CHECK_INTERVAL_MS / 1000}s`);
}

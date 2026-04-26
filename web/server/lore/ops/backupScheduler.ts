import { sql } from '../../db';
import { getSetting, getSettings } from '../config/settings';

const CHECK_INTERVAL_MS = 60_000;

function getTimeZonePart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value || '';
}

export function _getBackupScheduleSlot(now: Date, timeZone: string): { date: string; hour: number } {
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

async function claimBackupRun(date: string): Promise<boolean> {
  const result = await sql(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('backup.last_run_date', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     WHERE COALESCE(app_settings.value->>'value', '') <> $2
     RETURNING value`,
    [JSON.stringify({ value: date }), date],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

async function checkAndRunBackup(now = new Date()): Promise<void> {
  try {
    const enabled = await getSetting('backup.enabled');
    if (enabled === false || enabled === 'false') return;

    const s = await getSettings(['backup.schedule_hour', 'backup.timezone']);
    const scheduleHour = Number(s['backup.schedule_hour'] ?? 4);
    const tz = String(s['backup.timezone'] || 'Asia/Shanghai');

    const slot = _getBackupScheduleSlot(now, tz);
    if (slot.hour !== scheduleHour) return;
    if (!await claimBackupRun(slot.date)) return;

    console.log('[backup-scheduler] starting scheduled backup');
    const { exportToLocal, exportToWebDAV, cleanupLocalBackups, cleanupWebDAVBackups } = await import('./backup');
    const cfg = await getSettings([
      'backup.local.enabled', 'backup.webdav.enabled', 'backup.retention_count',
    ]);
    const retention = Number(cfg['backup.retention_count']) || 7;

    if (cfg['backup.local.enabled'] !== false) {
      await exportToLocal();
      await cleanupLocalBackups(retention);
    }
    if (cfg['backup.webdav.enabled'] === true) {
      await exportToWebDAV();
      await cleanupWebDAVBackups(retention);
    }

    console.log('[backup-scheduler] scheduled backup completed');
  } catch (err: unknown) {
    console.error('[backup-scheduler] failed', (err as Error).message);
  }
}

export const _checkAndRunBackupForTest = checkAndRunBackup;

declare let globalThis: { __loreBackupScheduler?: boolean } & typeof global;

export function initBackupScheduler(): void {
  if (globalThis.__loreBackupScheduler) return;
  globalThis.__loreBackupScheduler = true;
  setInterval(checkAndRunBackup, CHECK_INTERVAL_MS);
  console.log(`[backup-scheduler] initialized, checking every ${CHECK_INTERVAL_MS / 1000}s`);
}

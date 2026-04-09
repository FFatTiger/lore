import { sql } from '../../db';
import { getSetting, getSettings } from '../config/settings';

const CHECK_INTERVAL_MS = 60_000;

async function checkAndRunBackup(): Promise<void> {
  try {
    const enabled = await getSetting('backup.enabled');
    if (enabled === false || enabled === 'false') return;

    const s = await getSettings(['backup.schedule_hour', 'backup.timezone']);
    const scheduleHour = Number(s['backup.schedule_hour'] ?? 4);
    const tz = String(s['backup.timezone'] || 'Asia/Shanghai');

    const now = new Date();
    const localTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const currentHour = localTime.getHours();
    if (currentHour !== scheduleHour) return;

    const today = localTime.toISOString().slice(0, 10);
    let lastRunDate: string | null = null;
    try {
      const r = await sql(`SELECT value FROM app_settings WHERE key = 'backup.last_run_date'`);
      lastRunDate = (r.rows[0]?.value as Record<string, unknown>)?.value as string || null;
    } catch { /* ignore */ }
    if (lastRunDate === today) return;

    await sql(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('backup.last_run_date', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify({ value: today })],
    );

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

declare let globalThis: { __loreBackupScheduler?: boolean } & typeof global;

export function initBackupScheduler(): void {
  if (globalThis.__loreBackupScheduler) return;
  globalThis.__loreBackupScheduler = true;
  setInterval(checkAndRunBackup, CHECK_INTERVAL_MS);
  console.log(`[backup-scheduler] initialized, checking every ${CHECK_INTERVAL_MS / 1000}s`);
}

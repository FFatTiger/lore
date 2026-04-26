import { getSettings } from '../config/settings';
import { sql } from '../../db';
import { runDream } from '../dream/dreamDiary';
import {
  cleanupLocalBackups,
  cleanupWebDAVBackups,
  exportToLocal,
  exportToWebDAV,
} from '../ops/backup';
import { clearJobRegistryForTest, registerJob } from './registry';
import type { JobRunContext } from './types';

let registered = false;

async function preserveLegacyLastRunDate(context: JobRunContext, key: string): Promise<void> {
  if (context.trigger !== 'scheduled') return;

  const value = context.slot_key?.match(/^daily:(\d{4}-\d{2}-\d{2})/)?.[1] ?? new Date().toISOString().slice(0, 10);
  try {
    await sql(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify({ value })],
    );
  } catch (error) {
    console.error(`Failed to preserve legacy ${key}`, error);
  }
}

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
    run: async (context) => {
      const result = await runDream();
      await preserveLegacyLastRunDate(context, 'dream.last_run_date');
      return result;
    },
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
    run: async (context) => {
      const settings = await getSettings([
        'backup.local.enabled',
        'backup.webdav.enabled',
        'backup.retention_count',
      ]);
      const retention = Number(settings['backup.retention_count']) || 7;
      const results: Record<string, unknown> = {};

      if (settings['backup.local.enabled'] !== false) {
        results.local = await exportToLocal();
        await cleanupLocalBackups(retention);
      }

      if (settings['backup.webdav.enabled'] === true) {
        results.webdav = await exportToWebDAV();
        await cleanupWebDAVBackups(retention);
      }

      await preserveLegacyLastRunDate(context, 'backup.last_run_date');
      return results;
    },
  });
}

export function clearBuiltInJobsForTest(): void {
  registered = false;
  clearJobRegistryForTest();
}

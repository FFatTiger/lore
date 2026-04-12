import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../server/auth';
import { initBackupScheduler } from '../../../server/lore/ops/backupScheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

initBackupScheduler();

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || '';

  try {
    if (action === 'export') {
      const { exportDatabase } = await import('../../../server/lore/ops/backup');
      const includeRecall = searchParams.get('recall') === '1';
      const data = await exportDatabase({ includeRecallEvents: includeRecall });
      const json = JSON.stringify(data);
      const filename = `lore-backup-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.json`;
      return new Response(json, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    if (action === 'list') {
      const { listLocalBackups } = await import('../../../server/lore/ops/backup');
      return NextResponse.json({ backups: await listLocalBackups() });
    }

    if (action === 'download') {
      const filename = searchParams.get('filename');
      if (!filename) return NextResponse.json({ detail: 'Missing filename' }, { status: 400 });
      const { readLocalBackup } = await import('../../../server/lore/ops/backup');
      try {
        const content = await readLocalBackup(filename);
        return new Response(content, {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        return NextResponse.json({ detail: 'Backup file not found' }, { status: 404 });
      }
    }

    // Default: status
    const { sql } = await import('../../../server/db');
    const { listLocalBackups } = await import('../../../server/lore/ops/backup');
    const { getSetting } = await import('../../../server/lore/config/settings');
    let lastRunDate = null;
    try {
      const r = await sql(`SELECT value FROM app_settings WHERE key = 'backup.last_run_date'`);
      lastRunDate = r.rows[0]?.value?.value || null;
    } catch {}
    const backups = await listLocalBackups();
    const webdavEnabled = await getSetting('backup.webdav.enabled');
    return NextResponse.json({
      last_backup: lastRunDate,
      local_count: backups.length,
      webdav_enabled: webdavEnabled === true,
    });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Backup API failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'backup';

    if (action === 'restore') {
      const { restoreDatabase } = await import('../../../server/lore/ops/backup');
      if (!body.data) {
        return NextResponse.json({ detail: 'Missing backup data' }, { status: 400 });
      }
      const result = await restoreDatabase(body.data);
      return NextResponse.json(result);
    }

    // Default: run backup
    const { exportToLocal, exportToWebDAV, cleanupLocalBackups, cleanupWebDAVBackups } = await import('../../../server/lore/ops/backup');
    const { getSettings } = await import('../../../server/lore/config/settings');
    const cfg = await getSettings([
      'backup.local.enabled', 'backup.webdav.enabled', 'backup.retention_count',
    ]);
    const retention = Number(cfg['backup.retention_count']) || 7;
    const results: Record<string, unknown> = {};

    if (cfg['backup.local.enabled'] !== false) {
      results.local = await exportToLocal();
      await cleanupLocalBackups(retention);
    }
    if (cfg['backup.webdav.enabled'] === true) {
      results.webdav = await exportToWebDAV();
      await cleanupWebDAVBackups(retention);
    }

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Backup failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}

'use client';

import React, { useEffect, useState, useRef } from 'react';
import { format } from 'date-fns';
import clsx from 'clsx';
import { Database, Download, Upload, Trash2, RefreshCw, HardDrive, CheckCircle } from 'lucide-react';
import { PageCanvas, PageTitle, Button, Card, Section, Badge, EmptyState } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { getBackupStatus, listBackups, createBackup, restoreBackup } from '../../lib/api';
import { useConfirm } from '../../components/ConfirmDialog';

interface BackupMeta {
  filename: string;
  size: number;
  created_at: string;
  type?: 'local' | 'webdav';
}

interface BackupStatus {
  last_backup: string | null;
  local_count: number;
  webdav_enabled: boolean;
}

interface BackupList {
  backups: BackupMeta[];
}

export default function BackupPage(): React.JSX.Element {
  const { t } = useT();
  const { confirm: confirmDialog } = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, b] = await Promise.all([
        getBackupStatus() as Promise<BackupStatus>,
        listBackups() as Promise<BackupList>,
      ]);
      setStatus(s);
      setBackups(b.backups || []);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load backup status');
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  const handleBackup = async () => {
    setError(null);
    setLoading(true);
    try {
      await createBackup();
      await loadStatus();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Backup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (file: File) => {
    const ok = await confirmDialog({
      message: 'Restore will overwrite current memory data. Are you sure?',
      destructive: true,
      confirmLabel: 'Restore',
    });
    if (!ok) return;

    setRestoring(true);
    setError(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await (restoreBackup as (d: unknown) => Promise<unknown>)(data);
      setRestored(true);
      setTimeout(() => setRestored(false), 3000);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  };

  return (
    <PageCanvas>
      <PageTitle
        eyebrow="System"
        title="Backup"
        description="Export, import, and manage Lore memory snapshots."
        right={
          <Button variant="primary" size="sm" onClick={handleBackup} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Backup Now
          </Button>
        }
      />

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card padded>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sys-blue/15">
              <Database size={18} className="text-sys-blue" />
            </div>
            <div>
              <div className="text-[12px] font-medium text-txt-tertiary">Last Backup</div>
              <div className="text-[15px] font-semibold text-txt-primary mt-0.5">
                {status?.last_backup
                  ? format(new Date(status.last_backup), 'MM-dd HH:mm')
                  : '—'}
              </div>
            </div>
          </div>
        </Card>

        <Card padded>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sys-green/15">
              <HardDrive size={18} className="text-sys-green" />
            </div>
            <div>
              <div className="text-[12px] font-medium text-txt-tertiary">Local Backups</div>
              <div className="text-[15px] font-semibold text-txt-primary mt-0.5">
                {status?.local_count ?? '—'}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Restore section */}
      <Section title="Restore from Backup" subtitle="Upload a JSON backup file to restore memory data" className="mb-6">
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleRestore(file);
              e.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring}
          >
            <Upload size={13} />
            Upload Backup File
          </Button>
          {restoring && <span className="text-[13px] text-txt-secondary">Restoring...</span>}
          {restored && (
            <span className="flex items-center gap-1.5 text-[13px] text-sys-green">
              <CheckCircle size={13} /> Restored successfully
            </span>
          )}
        </div>
      </Section>

      {/* Backup list */}
      <Section
        title="Local Backups"
        subtitle={`${backups.length} snapshot${backups.length !== 1 ? 's' : ''}`}
        right={
          <Button variant="ghost" size="sm" onClick={loadStatus} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </Button>
        }
      >
        {error && (
          <div className="mb-4 rounded-xl border border-sys-red/30 bg-sys-red/10 px-4 py-3 text-[13px] text-sys-red">
            {error}
          </div>
        )}

        {!loaded || loading ? (
          <div className="flex items-center justify-center py-10">
            <RefreshCw size={18} className="animate-spin text-txt-quaternary" />
          </div>
        ) : backups.length === 0 ? (
          <EmptyState text="No backups yet. Click 'Backup Now' to create one." icon={HardDrive} />
        ) : (
          <div className="divide-y divide-separator-thin">
            {backups.map((b) => (
              <div key={b.filename} className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-fill-quaternary">
                    <HardDrive size={14} className="text-txt-secondary" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-txt-primary truncate">{b.filename}</div>
                    <div className="text-[12px] text-txt-tertiary mt-0.5">
                      {b.created_at ? format(new Date(b.created_at), 'yyyy-MM-dd HH:mm') : '—'} · {fmtSize(b.size)}
                    </div>
                  </div>
                </div>
                <a
                  href={`/api/backup?action=download&filename=${encodeURIComponent(b.filename)}`}
                  download
                  className="press shrink-0 ml-3 flex h-7 w-7 items-center justify-center rounded-full bg-sys-blue/15 text-sys-blue hover:bg-sys-blue/25 transition-colors"
                  title="Download"
                >
                  <Download size={13} />
                </a>
              </div>
            ))}
          </div>
        )}
      </Section>
    </PageCanvas>
  );
}

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { AxiosError } from 'axios';
import { api } from '@/lib/api';
import { PageCanvas, PageTitle, Section, Badge, Button, Card } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useConfirm } from '@/components/ConfirmDialog';
import {
  groupSettingsSections,
  SettingsSectionEditor,
  type SettingsData,
  type SectionGroup,
} from '@/components/settings/SettingsSectionEditor';
import { useSettingsFlow } from '@/components/settings/useSettingsFlow';

interface ToastState {
  type: 'success' | 'error';
  text: string;
}

export default function SettingsPage(): React.JSX.Element {
  const { t } = useT();
  const [toast, setToast] = useState<ToastState | null>(null);
  const { confirm: confirmDialog } = useConfirm();
  const {
    data,
    draft,
    loading,
    saving,
    rebuilding,
    error,
    dirtyKeys,
    clearDraft,
    handleChange,
    handleReset,
    handleRebuild,
    handleSave,
  } = useSettingsFlow({
    t,
    confirmDialog,
    notify: useCallback((text: string, type: 'success' | 'error') => {
      setToast({ type, text });
    }, []),
  });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const grouped = useMemo(() => groupSettingsSections(data), [data]);

  const weightSum = useMemo((): number | null => {
    if (!data) return null;
    const keys = [
      'recall.weights.w_exact',
      'recall.weights.w_glossary_semantic',
      'recall.weights.w_dense',
      'recall.weights.w_lexical',
    ];
    const effective = (key: string): number => (key in draft ? Number(draft[key]) : Number(data.values[key]));
    return keys.reduce((acc, key) => acc + (Number.isFinite(effective(key)) ? effective(key) : 0), 0);
  }, [data, draft]);

  const sectionRight = useCallback((section: SectionGroup): React.ReactNode => {
    if (section.id === 'recall_weights' && weightSum !== null) {
      return (
        <Badge tone={Math.abs(weightSum - 1) < 0.02 ? 'green' : 'orange'}>
          Σ = {weightSum.toFixed(3)}
        </Badge>
      );
    }
    if (section.id === 'embedding') {
      return (
        <Button size="sm" variant="secondary" onClick={() => void handleRebuild()} disabled={rebuilding || saving}>
          {rebuilding ? t('Rebuilding…') : t('Rebuild Index')}
        </Button>
      );
    }
    return null;
  }, [handleRebuild, rebuilding, saving, t, weightSum]);

  return (
    <PageCanvas maxWidth="4xl">
      <PageTitle
        eyebrow={t('Configuration')}
        title={t('Settings')}
        description={t('Runtime parameters for the recall pipeline. Changes take effect immediately.')}
        right={
          <>
            {dirtyKeys.length > 0 && (
              <Button variant="ghost" onClick={clearDraft} disabled={saving}>
                {t('Discard')}
              </Button>
            )}
            <Button variant="primary" onClick={() => void handleSave()} disabled={saving || dirtyKeys.length === 0}>
              {saving ? t('Saving…') : dirtyKeys.length > 0 ? `${t('Save')} ${dirtyKeys.length}` : t('Save')}
            </Button>
          </>
        }
      />

      {toast && (
        <div className="animate-scale mb-4 rounded-xl bg-sys-green/10 border border-sys-green/20 px-3.5 py-2.5 text-[13px] text-sys-green">
          {toast.text}
        </div>
      )}
      {error && (
        <div className="animate-scale mb-4 rounded-xl bg-sys-red/10 border border-sys-red/20 px-3.5 py-2.5 text-[13px] text-sys-red">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-fill-tertiary border-t-sys-blue" />
        </div>
      )}

      {data && !loading && (
        <div className="space-y-5">
          {grouped.map((section, index) => (
            <div key={section.id} className={clsx('animate-in', `stagger-${Math.min(index + 1, 6)}`)}>
              <Card className="overflow-hidden p-0">
                <SettingsSectionEditor
                  section={section}
                  data={data}
                  draft={draft}
                  saving={saving}
                  onChange={handleChange}
                  onReset={(key) => void handleReset(key)}
                  right={sectionRight(section)}
                />
              </Card>
            </div>
          ))}
          <BackupActionPanel />
        </div>
      )}
    </PageCanvas>
  );
}

function fmtBytes(bytes: number | undefined): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface BackupInfo {
  filename: string;
  size?: number;
}

interface BackupStatus {
  last_backup?: string;
}

function BackupActionPanel(): React.JSX.Element {
  const { t } = useT();
  const { confirm: confirmDialog } = useConfirm();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [restoringFile, setRestoringFile] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [message, setMessage] = useState<ToastState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus((await api.get('/backup')).data as BackupStatus);
    } catch {}
  }, []);

  const loadBackups = useCallback(async () => {
    try {
      setBackups(((await api.get('/backup', { params: { action: 'list' } })).data as { backups?: BackupInfo[] }).backups || []);
    } catch {}
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadBackups();
  }, [loadBackups, loadStatus]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await api.get('/backup', {
        params: { action: 'export' },
        responseType: 'blob',
      });
      const disposition = (response.headers as Record<string, string>)?.['content-disposition'] || '';
      const filename = disposition.match(/filename="(.+)"/)?.[1] || 'lore-backup.json';
      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setMessage({ type: 'success', text: t('Export completed') });
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setMessage({ type: 'error', text: axiosErr.response?.data?.detail || axiosErr.message });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (file: File) => {
    const ok = await confirmDialog({
      message: t('Confirm restore? This will replace ALL current data.'),
      destructive: true,
      confirmLabel: t('Restore'),
    });
    if (!ok) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await api.post('/backup', { action: 'restore', data });
      setMessage({ type: 'success', text: `${t('Restore completed')} (${(result.data as Record<string, unknown>).duration_ms}ms)` });
      void loadStatus();
      void loadBackups();
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setMessage({ type: 'error', text: axiosErr.response?.data?.detail || axiosErr.message });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRunBackup = async () => {
    setBackupRunning(true);
    try {
      await api.post('/backup', { action: 'backup' });
      setMessage({ type: 'success', text: t('Backup completed') });
      void loadStatus();
      void loadBackups();
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setMessage({ type: 'error', text: axiosErr.response?.data?.detail || axiosErr.message });
    } finally {
      setBackupRunning(false);
    }
  };

  const handleRestoreFile = async (filename: string) => {
    const ok = await confirmDialog({
      message: t('Confirm restore? This will replace ALL current data.'),
      destructive: true,
      confirmLabel: t('Restore'),
    });
    if (!ok) return;

    setRestoringFile(filename);
    try {
      const result = await api.post('/backup', { action: 'restore-file', filename });
      setMessage({ type: 'success', text: `${t('Restore completed')} (${(result.data as Record<string, unknown>).duration_ms}ms)` });
      void loadStatus();
      void loadBackups();
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setMessage({ type: 'error', text: axiosErr.response?.data?.detail || axiosErr.message });
    } finally {
      setRestoringFile(null);
    }
  };

  return (
    <div className="animate-in stagger-6">
      <Section
        padded={false}
        title={t('Backup Actions')}
        subtitle={t('Manual backup and restore operations')}
        right={status?.last_backup ? <Badge tone="default">{t('Last backup')}: {status.last_backup}</Badge> : null}
      >
        <div className="px-4 md:px-6 py-4 space-y-4">
          {message && (
            <div
              className={clsx(
                'rounded-xl px-3.5 py-2.5 text-[13px]',
                message.type === 'success'
                  ? 'bg-sys-green/10 border border-sys-green/20 text-sys-green'
                  : 'bg-sys-red/10 border border-sys-red/20 text-sys-red',
              )}
            >
              {message.text}
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <Button variant="primary" onClick={handleRunBackup} disabled={backupRunning}>
              {backupRunning ? t('Backing up…') : t('Run Backup Now')}
            </Button>
            <Button variant="secondary" onClick={handleExport} disabled={exporting}>
              {exporting ? t('Exporting…') : t('Export & Download')}
            </Button>
            <Button variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? t('Restoring…') : t('Import & Restore')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(event) => event.target.files?.[0] && void handleImport(event.target.files[0])}
            />
          </div>

          {backups.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-separator-thin text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">
                    <th className="px-0 py-2 first:pr-4">{t('Date')}</th>
                    <th className="px-0 py-2 text-right">{t('Size')}</th>
                    <th className="px-0 py-2 text-right last:pl-4">{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.slice(0, 10).map((backup) => (
                    <tr key={backup.filename} className="border-b border-separator-hairline last:border-b-0">
                      <td className="px-0 py-2 font-mono text-txt-primary first:pr-4">
                        {backup.filename.replace('lore-backup-', '').replace('.json', '')}
                      </td>
                      <td className="px-0 py-2 text-right text-txt-tertiary">{fmtBytes(backup.size)}</td>
                      <td className="px-0 py-2 text-right last:pl-4">
                        <Button variant="ghost" size="sm" onClick={() => void handleRestoreFile(backup.filename)} disabled={!!restoringFile}>
                          {restoringFile === backup.filename ? t('Restoring…') : t('Restore')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

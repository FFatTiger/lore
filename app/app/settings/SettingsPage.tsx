'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, ReactNode, ChangeEvent } from 'react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { PageCanvas, PageTitle, Section, Badge, Button } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { AxiosError } from 'axios';

type SettingSource = 'db' | 'env' | 'default';

interface FieldSchema {
  key: string;
  label: string;
  type: 'number' | 'integer' | 'string' | 'enum';
  description?: string;
  env?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  option_labels?: Record<string, string>;
  section: string;
}

interface SectionSchema {
  id: string;
  label: string;
  description?: string;
}

interface SettingsData {
  schema: FieldSchema[];
  sections: SectionSchema[];
  values: Record<string, unknown>;
  defaults: Record<string, unknown>;
  sources: Record<string, SettingSource>;
}

interface SectionGroup extends SectionSchema {
  items: FieldSchema[];
}

interface SourceDotProps {
  source: SettingSource;
}

function SourceDot({ source }: SourceDotProps): React.JSX.Element {
  const { t } = useT();
  const map: Record<SettingSource, { tone: string; label: string }> = {
    db: { tone: 'bg-sys-blue', label: t('Modified') },
    env: { tone: 'bg-sys-green', label: t('From env') },
    default: { tone: 'bg-fill-primary', label: t('Default') },
  };
  const { tone, label } = map[source] || map.default;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-txt-tertiary">
      <span className={clsx('h-1.5 w-1.5 rounded-full', tone)} />
      {label}
    </span>
  );
}

interface NumberInputProps {
  value: unknown;
  onChange: (v: number | '') => void;
  schema: FieldSchema;
  disabled: boolean;
}

function NumberInput({ value, onChange, schema, disabled }: NumberInputProps): React.JSX.Element {
  const step = schema.step ?? (schema.type === 'integer' ? 1 : 0.01);
  return (
    <input
      type="number" step={step} min={schema.min} max={schema.max}
      value={value == null ? '' : String(value)} disabled={disabled}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      className="w-32 rounded-lg border border-separator-thin bg-bg-raised px-3 py-1.5 text-right text-[13px] font-mono tabular-nums text-txt-primary focus:border-sys-blue/60 focus:bg-bg-surface focus:outline-none disabled:opacity-40"
    />
  );
}

interface StringInputProps {
  value: unknown;
  onChange: (v: string) => void;
  disabled: boolean;
}

function StringInput({ value, onChange, disabled }: StringInputProps): React.JSX.Element {
  return (
    <input
      type="text" value={value == null ? '' : String(value)} disabled={disabled}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      className="w-full rounded-lg border border-separator-thin bg-bg-raised px-3 py-1.5 text-[13px] font-mono text-txt-primary focus:border-sys-blue/60 focus:bg-bg-surface focus:outline-none disabled:opacity-40"
    />
  );
}

interface EnumInputProps {
  value: unknown;
  onChange: (v: string) => void;
  schema: FieldSchema;
  disabled: boolean;
}

function EnumInput({ value, onChange, schema, disabled }: EnumInputProps): React.JSX.Element {
  const labels = schema.option_labels || {};
  return (
    <select value={value == null ? '' : String(value)} disabled={disabled}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      className="rounded-lg border border-separator-thin bg-bg-raised px-3 py-1.5 text-[13px] font-mono text-txt-primary cursor-pointer focus:border-sys-blue/60 focus:bg-bg-surface focus:outline-none disabled:opacity-40 max-w-full"
    >
      {(schema.options || []).map((opt) => (
        <option key={opt} value={opt}>{labels[opt] ? `${opt} — ${labels[opt]}` : opt}</option>
      ))}
    </select>
  );
}

interface FieldRowProps {
  schema: FieldSchema;
  value: unknown;
  defaultValue: unknown;
  source: SettingSource;
  dirty: boolean;
  onChange: (v: unknown) => void;
  onReset: () => void;
  saving: boolean;
}

function FieldRow({ schema, value, defaultValue: _defaultValue, source, dirty, onChange, onReset, saving }: FieldRowProps): React.JSX.Element {
  const { t } = useT();
  const isString = schema.type === 'string';
  const renderInput = () => {
    if (schema.type === 'number' || schema.type === 'integer') return <NumberInput value={value} onChange={onChange as (v: number | '') => void} schema={schema} disabled={saving} />;
    if (schema.type === 'enum') return <EnumInput value={value} onChange={onChange as (v: string) => void} schema={schema} disabled={saving} />;
    return <StringInput value={value} onChange={onChange as (v: string) => void} disabled={saving} />;
  };

  return (
    <div className={clsx(
      'grid gap-3 md:gap-4 border-b border-separator-hairline px-4 md:px-6 py-4 last:border-b-0 transition-colors',
      isString ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-[1fr_auto] sm:items-center',
      dirty && 'bg-sys-blue/[0.04]',
    )}>
      <div className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[14px] font-medium text-txt-primary">{schema.label}</span>
          <SourceDot source={source} />
          {dirty && <Badge tone="blue">{t('Unsaved')}</Badge>}
          {source !== 'default' && !dirty && (
            <button type="button" onClick={onReset} disabled={saving}
              className="text-[11px] text-sys-blue hover:opacity-80 disabled:opacity-30">
              {t('Reset')}
            </button>
          )}
        </div>
        {schema.description && (
          <p className="mt-0.5 text-[12.5px] text-txt-secondary leading-relaxed">{schema.description}</p>
        )}
        <p className="mt-1 text-[11px] text-txt-quaternary font-mono">
          {schema.key}
          {schema.env && <> · env: {schema.env}</>}
          {(schema.min !== undefined || schema.max !== undefined) && <> · range [{schema.min ?? '∞'}, {schema.max ?? '∞'}]</>}
        </p>
      </div>
      <div className={isString ? '' : 'shrink-0'}>
        {renderInput()}
      </div>
    </div>
  );
}

interface ToastState {
  type: 'success' | 'error';
  text: string;
}

export default function SettingsPage(): React.JSX.Element {
  const { t } = useT();
  const [data, setData] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: d } = await api.get('/settings');
      setData(d); setDraft({});
    } catch (e) {
      const axiosErr = e as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || 'Failed to load');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const dirtyKeys = useMemo(() => Object.keys(draft), [draft]);

  const handleChange = useCallback((key: string, newValue: unknown) => {
    setDraft((prev) => {
      if (!data) return prev;
      const current = data.values[key];
      if (newValue === current || (newValue === '' && current === '')) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: newValue };
    });
  }, [data]);

  const handleReset = useCallback(async (key: string) => {
    setSaving(true); setError(null);
    try {
      const { data: next } = await api.post('/settings/reset', { keys: [key] });
      setData(next);
      setDraft((prev) => { const { [key]: _, ...rest } = prev; return rest; });
      setToast({ type: 'success', text: `Reset ${key}` });
    } catch (e) {
      const axiosErr = e as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || 'Reset failed');
    }
    finally { setSaving(false); }
  }, []);

  const handleSave = useCallback(async () => {
    if (!dirtyKeys.length) return;
    setSaving(true); setError(null);
    try {
      const { data: next } = await api.put('/settings', { patch: draft });
      setData(next); setDraft({});
      setToast({ type: 'success', text: `Saved ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}` });
    } catch (e) {
      const axiosErr = e as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || 'Save failed');
    }
    finally { setSaving(false); }
  }, [draft, dirtyKeys]);

  const handleDiscard = useCallback(() => setDraft({}), []);

  const grouped = useMemo((): SectionGroup[] => {
    if (!data) return [];
    const bySection = new Map<string, SectionGroup>(data.sections.map((s) => [s.id, { ...s, items: [] }]));
    for (const item of data.schema) {
      const section = bySection.get(item.section);
      if (section) section.items.push(item);
    }
    return [...bySection.values()];
  }, [data]);

  const weightSum = useMemo((): number | null => {
    if (!data) return null;
    const keys = ['recall.weights.w_exact', 'recall.weights.w_glossary_semantic', 'recall.weights.w_dense', 'recall.weights.w_lexical'];
    const effective = (k: string): number => (k in draft ? Number(draft[k]) : Number(data.values[k]));
    return keys.reduce((acc, k) => acc + (Number.isFinite(effective(k)) ? effective(k) : 0), 0);
  }, [data, draft]);

  return (
    <PageCanvas maxWidth="4xl">
      <PageTitle
        eyebrow={t('Configuration')}
        title={t('Settings')}
        description={t('Runtime parameters for the recall pipeline. Changes take effect immediately.')}
        right={
          <>
            {dirtyKeys.length > 0 && (
              <Button variant="ghost" onClick={handleDiscard} disabled={saving}>{t('Discard')}</Button>
            )}
            <Button variant="primary" onClick={handleSave} disabled={saving || dirtyKeys.length === 0}>
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
          {grouped.map((section, i) => (
            <div key={section.id} className={clsx('animate-in', `stagger-${Math.min(i + 1, 6)}`)}>
              <Section
                padded={false}
                title={section.label}
                subtitle={section.description}
                right={section.id === 'recall_weights' && weightSum !== null ? (
                  <Badge tone={Math.abs(weightSum - 1) < 0.02 ? 'green' : 'orange'}>
                    Σ = {weightSum.toFixed(3)}
                  </Badge>
                ) : null}
              >
                {section.items.map((schema) => {
                  const effectiveValue = schema.key in draft ? draft[schema.key] : data.values[schema.key];
                  return (
                    <FieldRow
                      key={schema.key}
                      schema={schema}
                      value={effectiveValue}
                      defaultValue={data.defaults[schema.key]}
                      source={data.sources[schema.key]}
                      dirty={schema.key in draft}
                      onChange={(v) => handleChange(schema.key, v)}
                      onReset={() => handleReset(schema.key)}
                      saving={saving}
                    />
                  );
                })}
              </Section>
            </div>
          ))}
          <BackupActionPanel />
        </div>
      )}
    </PageCanvas>
  );
}

// ─── Backup Action Panel ──────────────────────────────────────────────

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
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [message, setMessage] = useState<ToastState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    try { setStatus((await api.get('/backup')).data); } catch {}
  }, []);

  const loadBackups = useCallback(async () => {
    try { setBackups((await api.get('/backup', { params: { action: 'list' } })).data.backups || []); } catch {}
  }, []);

  useEffect(() => { loadStatus(); loadBackups(); }, [loadStatus, loadBackups]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const resp = await api.get('/backup', {
        params: { action: 'export' },
        responseType: 'blob',
      });
      const disposition = (resp.headers as Record<string, string>)?.['content-disposition'] || '';
      const filename = disposition.match(/filename="(.+)"/)?.[1] || 'lore-backup.json';
      const url = URL.createObjectURL(resp.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ type: 'success', text: t('Export completed') });
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setMessage({ type: 'error', text: axiosErr.response?.data?.detail || axiosErr.message });
    } finally { setExporting(false); }
  };

  const handleImport = async (file: File) => {
    if (!confirm(t('Confirm restore? This will replace ALL current data.'))) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await api.post('/backup', { action: 'restore', data });
      setMessage({ type: 'success', text: `${t('Restore completed')} (${(result.data as Record<string, unknown>).duration_ms}ms)` });
      loadStatus();
      loadBackups();
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
      loadStatus();
      loadBackups();
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setMessage({ type: 'error', text: axiosErr.response?.data?.detail || axiosErr.message });
    } finally { setBackupRunning(false); }
  };

  return (
    <div className="animate-in stagger-6">
      <Section
        padded={false}
        title={t('Backup Actions')}
        subtitle={t('Manual backup and restore operations')}
        right={status?.last_backup ? (
          <Badge tone="default">{t('Last backup')}: {status.last_backup}</Badge>
        ) : null}
      >
        <div className="px-4 md:px-6 py-4 space-y-4">
          {message && (
            <div className={clsx('rounded-xl px-3.5 py-2.5 text-[13px]',
              message.type === 'success' ? 'bg-sys-green/10 border border-sys-green/20 text-sys-green' : 'bg-sys-red/10 border border-sys-red/20 text-sys-red'
            )}>{message.text}</div>
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
            <input ref={fileInputRef} type="file" accept=".json" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])} />
          </div>

          {backups.length > 0 && (
            <div className="rounded-xl border border-separator-thin overflow-hidden">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-separator-thin text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">
                    <th className="px-4 py-2">{t('Date')}</th>
                    <th className="px-4 py-2 text-right">{t('Size')}</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.slice(0, 10).map((b) => (
                    <tr key={b.filename} className="border-b border-separator-hairline last:border-b-0">
                      <td className="px-4 py-2 font-mono text-txt-primary">{b.filename.replace('lore-backup-', '').replace('.json', '')}</td>
                      <td className="px-4 py-2 text-right text-txt-tertiary">{fmtBytes(b.size)}</td>
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

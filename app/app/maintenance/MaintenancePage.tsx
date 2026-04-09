'use client';

import React, { useEffect, useState, useCallback, MouseEvent } from 'react';
import { format } from 'date-fns';
import clsx from 'clsx';
import DiffViewer from '../../components/DiffViewer';
import { api } from '../../lib/api';
import { PageCanvas, PageTitle, Button, Badge, EmptyState } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { AxiosError } from 'axios';
import { useConfirm } from '../../components/ConfirmDialog';

interface MigrationTarget {
  id?: string | number;
  paths: string[];
  content?: string;
}

interface OrphanItem {
  id: string | number;
  category: 'deprecated' | 'orphaned';
  created_at?: string;
  content_snippet?: string;
  migration_target?: MigrationTarget;
}

interface OrphanDetail {
  content?: string;
  migration_target?: MigrationTarget & { id?: string | number };
  error?: string;
}

export default function MaintenancePage(): React.JSX.Element {
  const { t } = useT();
  const { confirm: confirmDialog } = useConfirm();
  const [orphans, setOrphans] = useState<OrphanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const [detailData, setDetailData] = useState<Record<string | number, OrphanDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  useEffect(() => { loadOrphans(); }, []);

  const loadOrphans = async () => {
    setLoading(true); setError(null); setSelectedIds(new Set());
    try { setOrphans((await api.get('/maintenance/orphans')).data); }
    catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message);
    }
    finally { setLoading(false); }
  };

  const toggleSelect = useCallback((id: string | number, e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const handleBatchDelete = async () => {
    if (!selectedIds.size) return;
    const ok = await confirmDialog({ message: t('Delete {n} memories?').replace('{n}', String(selectedIds.size)), destructive: true, confirmLabel: t('Delete') });
    if (!ok) return;
    setBatchDeleting(true);
    const toDelete = [...selectedIds], failed: Array<string | number> = [];
    for (const id of toDelete) { try { await api.delete(`/maintenance/orphans/${id}`); } catch { failed.push(id); } }
    const fs = new Set(failed);
    setOrphans(prev => prev.filter(i => !toDelete.includes(i.id) || fs.has(i.id)));
    setSelectedIds(new Set(failed));
    if (expandedId && toDelete.includes(expandedId) && !fs.has(expandedId)) setExpandedId(null);
    setBatchDeleting(false);
  };

  const handleExpand = async (id: string | number) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!detailData[id]) {
      setDetailLoading(id);
      try { const res = await api.get(`/maintenance/orphans/${id}`); setDetailData(p => ({ ...p, [id]: res.data })); }
      catch (err) {
        const axiosErr = err as AxiosError;
        setDetailData(p => ({ ...p, [id]: { error: axiosErr.message } }));
      }
      finally { setDetailLoading(null); }
    }
  };

  const deprecated = orphans.filter(o => o.category === 'deprecated');
  const orphaned = orphans.filter(o => o.category === 'orphaned');

  const renderEntry = (item: OrphanItem) => {
    const isExpanded = expandedId === item.id;
    const detail = detailData[item.id];
    const isChecked = selectedIds.has(item.id);
    const cat = item.category === 'deprecated' ? { tone: 'orange' as const, label: t('Deprecated') } : { tone: 'red' as const, label: t('Orphaned') };

    return (
      <div key={item.id}
        className={clsx('rounded-2xl border shadow-card transition-all duration-200', isChecked ? 'border-sys-blue/50 bg-sys-blue/[0.04]' : 'border-separator-thin bg-bg-elevated')}>
        <div className="flex items-start gap-4 p-5 cursor-pointer group" onClick={() => handleExpand(item.id)}>
          <button
            onClick={(e) => toggleSelect(item.id, e)}
            aria-label={isChecked ? 'deselect' : 'select'}
            className={clsx(
              'press mt-0.5 shrink-0 h-[18px] w-[18px] rounded-md border transition-colors flex items-center justify-center',
              isChecked ? 'border-sys-blue bg-sys-blue' : 'border-separator group-hover:border-txt-tertiary',
            )}
          >
            {isChecked && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-white">
                <path d="M1.5 5.2l2 2L8.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <Badge tone={cat.tone}>{cat.label}</Badge>
              <span className="text-[11px] font-mono text-txt-tertiary">#{String(item.id)}</span>
              {item.created_at && (
                <span className="text-[11px] text-txt-quaternary">{format(new Date(item.created_at), 'yyyy-MM-dd HH:mm')}</span>
              )}
            </div>
            {item.migration_target && item.migration_target.paths.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[11px]">
                <span className="text-txt-tertiary">{t('migrated to')}</span>
                {item.migration_target.paths.map((p, i) => (
                  <code key={i} className="font-mono text-sys-blue">{p}</code>
                ))}
              </div>
            )}
            <p className="mt-2 line-clamp-3 text-[13.5px] leading-snug text-txt-secondary">
              {item.content_snippet}
            </p>
          </div>
          <span className="text-[11px] text-txt-tertiary group-hover:text-sys-blue shrink-0 self-start">
            {isExpanded ? '−' : '+'}
          </span>
        </div>
        {isExpanded && (
          <div className="animate-in border-t border-separator-hairline px-5 pb-5 pt-4 space-y-4">
            {detailLoading === item.id ? (
              <p className="text-[12px] text-txt-tertiary">{t('Loading…')}</p>
            ) : detail?.error ? (
              <p className="text-[13px] text-sys-red">{detail.error}</p>
            ) : detail ? (
              <>
                <div>
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Full text')}</div>
                  <pre className="rounded-xl border border-separator-thin bg-bg-inset p-4 font-mono text-[12px] leading-relaxed text-txt-secondary whitespace-pre-wrap max-h-64 overflow-y-auto">{detail.content}</pre>
                </div>
                {detail.migration_target && (
                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Diff')} → #{detail.migration_target.id}</div>
                    <div className="rounded-xl border border-separator-thin bg-bg-inset p-4 max-h-96 overflow-y-auto">
                      <DiffViewer oldText={detail.content || ''} newText={detail.migration_target.content || ''} />
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <PageCanvas maxWidth="4xl">
      <PageTitle
        eyebrow={t('Cleanup')}
        title={t('Orphans')}
        description={t('Memories that no longer connect to the active graph. Review and remove what is safe to drop.')}
        right={
          <>
            {selectedIds.size > 0 && (
              <Button variant="destructive" onClick={handleBatchDelete} disabled={batchDeleting}>
                {batchDeleting ? t('Deleting…') : `${t('Delete')} ${selectedIds.size}`}
              </Button>
            )}
            <Button variant="ghost" onClick={loadOrphans} disabled={loading}>
              {loading ? t('Scanning…') : t('Rescan')}
            </Button>
          </>
        }
      />

      <div className="animate-in stagger-1 mb-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-card px-5 py-4">
          <div className="text-[11px] font-medium text-txt-tertiary">{t('Deprecated')}</div>
          <div className="mt-1.5 text-[28px] font-bold leading-none tracking-tight tabular-nums text-sys-orange">{deprecated.length}</div>
        </div>
        <div className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-card px-5 py-4">
          <div className="text-[11px] font-medium text-txt-tertiary">{t('Orphaned')}</div>
          <div className="mt-1.5 text-[28px] font-bold leading-none tracking-tight tabular-nums text-sys-red">{orphaned.length}</div>
        </div>
      </div>

      {error && (
        <div className="animate-scale mb-4 rounded-xl bg-sys-red/10 border border-sys-red/20 px-3.5 py-2.5 text-[13px] text-sys-red">
          {error}
        </div>
      )}

      {loading && !orphans.length && (
        <div className="flex justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-fill-tertiary border-t-sys-blue" />
        </div>
      )}

      {!loading && !error && !orphans.length && (
        <EmptyState text={t('All clear. No orphans to review.')} />
      )}

      {!error && orphans.length > 0 && (
        <div className="animate-in stagger-2 space-y-8">
          {deprecated.length > 0 && (
            <div>
              <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">
                {t('Deprecated')} · {deprecated.length}
              </h2>
              <div className="space-y-2.5">{deprecated.map(renderEntry)}</div>
            </div>
          )}
          {orphaned.length > 0 && (
            <div>
              <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">
                {t('Orphaned')} · {orphaned.length}
              </h2>
              <div className="space-y-2.5">{orphaned.map(renderEntry)}</div>
            </div>
          )}
        </div>
      )}
    </PageCanvas>
  );
}

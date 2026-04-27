'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageCanvas, PageTitle, Button, Badge, CodeDiff } from '../../../../components/ui';
import { useT } from '../../../../lib/i18n';
import { AxiosError } from 'axios';

interface MigrationTarget {
  id: number;
  content: string;
  paths: string[];
  created_at: string;
}

interface OrphanDetail {
  id: number;
  content: string;
  created_at: string | null;
  deprecated: boolean;
  migrated_to: number | null;
  category: string;
  migration_target: MigrationTarget | null;
}

export default function OrphanDetailPage() {
  const rawParams = useParams();
  const memoryId = Number((rawParams as { memoryId?: string })?.memoryId);
  const { t } = useT();
  const router = useRouter();
  const [detail, setDetail] = useState<OrphanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(memoryId)) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const { data } = await api.get(`/maintenance/orphans/${memoryId}`);
        if (!cancelled) setDetail(data);
      } catch (e) {
        const axiosErr = e as AxiosError<{ detail?: string }>;
        if (!cancelled) setError(axiosErr.response?.data?.detail || axiosErr.message || t('Failed to load'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [memoryId, t]);

  async function handleDelete() {
    if (!confirm(t('Permanently delete this memory? This cannot be undone.'))) return;
    setDeleting(true);
    try {
      await api.delete(`/maintenance/orphans/${memoryId}`);
      router.push('/maintenance');
    } catch (e) {
      const axiosErr = e as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || t('Delete failed'));
    } finally {
      setDeleting(false);
    }
  }

  const hasDiff = detail?.migration_target && detail.content !== detail.migration_target.content;

  return (
    <PageCanvas maxWidth="5xl">
      <PageTitle
        eyebrow={t('Orphan Detail')}
        title={`#${memoryId}`}
        titleText={`#${memoryId}`}
        truncateTitle
        right={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => router.push('/maintenance')}>
              ← {t('Back')}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? t('Deleting…') : t('Delete')}
            </Button>
          </div>
        }
      />

      {loading && <p className="text-[13px] text-txt-tertiary">{t('Loading…')}</p>}
      {error && <p className="text-[13px] text-sys-red">{error}</p>}

      {detail && (
        <div className="space-y-5">
          {/* meta */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={detail.category === 'deprecated' ? 'orange' : 'default'}>
              {detail.category === 'deprecated' ? t('Deprecated') : detail.category === 'orphaned' ? t('Orphaned') : detail.category}
            </Badge>
            {detail.migrated_to && (
              <span className="text-[12px] text-txt-tertiary">
                {t('Migrated to')} #{detail.migrated_to}
              </span>
            )}
            {detail.created_at && (
              <span className="text-[12px] text-txt-quaternary">
                {new Date(detail.created_at).toLocaleString()}
              </span>
            )}
          </div>

          {/* paths */}
          {detail.migration_target?.paths && detail.migration_target.paths.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Paths')}</div>
              <div className="flex flex-wrap gap-1">
                {detail.migration_target.paths.map((p) => (
                  <span key={p} className="inline-block rounded-md border border-separator-thin bg-bg-raised px-2 py-0.5 font-mono text-[11px] text-txt-secondary">{p}</span>
                ))}
              </div>
            </div>
          )}

          {/* diff — shows old vs new content side by side */}
          {detail.migration_target ? (
            detail.content !== detail.migration_target.content ? (
              <div>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">
                  {t('Diff')} ← #{detail.id} / #{detail.migration_target.id} →
                </div>
              <div className="w-full min-h-[400px]">
                <CodeDiff
                  language="markdown"
                  oldContent={detail.content || ''}
                  newContent={detail.migration_target.content || ''}
                  showHeader={false}
                  viewMode="split"
                />
              </div>
              </div>
            ) : (
              <div>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">
                  {t('Content unchanged')} — #{detail.id} → #{detail.migration_target.id}
                </div>
                <pre className="rounded-xl border border-separator-thin bg-bg-inset p-4 font-mono text-[12px] leading-relaxed text-txt-secondary whitespace-pre-wrap max-h-[70vh] overflow-y-auto">
                  {detail.content}
                </pre>
                <p className="mt-2 text-[12px] text-txt-tertiary">{t('Both versions have identical content. Only routes or metadata differ.')}</p>
              </div>
            )
          ) : (
            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Content')}</div>
              <pre className="rounded-xl border border-separator-thin bg-bg-inset p-4 font-mono text-[12px] leading-relaxed text-txt-secondary whitespace-pre-wrap max-h-[70vh] overflow-y-auto">
                {detail.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </PageCanvas>
  );
}

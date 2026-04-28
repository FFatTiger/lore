'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AxiosError } from 'axios';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { api } from '../../../lib/api';
import { buildUrlWithSearchParams, readStringParam } from '../../../lib/url-state';
import { useT } from '../../../lib/i18n';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Badge, Button, CodeDiff, Disclosure, Empty, PageCanvas, PageTitle } from '../../../components/ui';
import { ChannelAvatar } from '../../../components/UpdaterDisplay';
import { clientTypeLabel } from '../../../components/clientTypeMeta';
import type { HistoryDiff, NodeHistoryPayload, NormalizedHistoryEvent } from '../../../server/lore/memory/history';

type HistoryPayload = NodeHistoryPayload;
type Translate = (key: string) => string;

function formatDate(value: string | null, t: Translate): string {
  if (!value) return t('Unknown time');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function diffLabel(field: string, t: Translate): string {
  if (field === 'glossary_keywords') return t('Glossary');
  if (field === 'uri') return t('Move');
  return t(field.charAt(0).toUpperCase() + field.slice(1));
}

function badgeTone(eventType: string): 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'default' {
  if (eventType === 'create') return 'green';
  if (eventType === 'update') return 'blue';
  if (eventType === 'delete') return 'red';
  if (eventType === 'move') return 'purple';
  if (eventType.startsWith('glossary_')) return 'orange';
  return 'default';
}

function ValueDiff({ diff, t }: { diff: HistoryDiff; t: Translate }): React.JSX.Element {
  if (diff.kind === 'text') {
    return (
      <CodeDiff
        className="overflow-hidden rounded-xl"
        fileName={diffLabel(diff.field, t)}
        language="markdown"
        newContent={stringifyValue(diff.after)}
        oldContent={stringifyValue(diff.before)}
        viewMode="unified"
      />
    );
  }

  if (diff.kind === 'keyword_add' || diff.kind === 'keyword_remove') {
    const added = diff.kind === 'keyword_add';
    return (
      <div className="rounded-xl border border-separator-thin bg-bg-raised px-3 py-2 font-mono text-[12px]">
        <span className={added ? 'text-sys-green' : 'text-sys-red'}>{added ? '+ ' : '- '}</span>
        <span className="text-txt-primary">{stringifyValue(added ? diff.after : diff.before)}</span>
      </div>
    );
  }

  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div className="rounded-xl border border-separator-thin bg-bg-raised px-3 py-2">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-txt-quaternary">{t('Before')}</div>
        <div className="break-words font-mono text-[12px] text-txt-secondary">{stringifyValue(diff.before)}</div>
      </div>
      <div className="rounded-xl border border-separator-thin bg-bg-raised px-3 py-2">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-txt-quaternary">{t('After')}</div>
        <div className="break-words font-mono text-[12px] text-txt-primary">{stringifyValue(diff.after)}</div>
      </div>
    </div>
  );
}

function HistoryDiffItem({ diff, t }: { diff: HistoryDiff; t: Translate }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const label = diffLabel(diff.field, t);

  return (
    <Disclosure
      className="rounded-xl border border-separator-thin bg-bg-raised/60 px-3 py-2"
      open={open}
      onOpenChange={setOpen}
      trigger={(
        <div className="flex w-full items-center justify-between gap-3 text-left">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-txt-tertiary">{label}</span>
          <span className="text-[12px] text-txt-quaternary">{open ? t('Collapse') : t('Expand')}</span>
        </div>
      )}
    >
      <div className="pt-3">
        <ValueDiff diff={diff} t={t} />
      </div>
    </Disclosure>
  );
}

function EventDiffs({ diffs, t }: { diffs: HistoryDiff[]; t: Translate }): React.JSX.Element {
  if (!diffs.length) {
    return <p className="text-[13px] text-txt-tertiary">{t('No textual changes.')}</p>;
  }

  return (
    <div className="space-y-3">
      {diffs.map((diff, index) => (
        <HistoryDiffItem key={`${diff.field}-${diff.kind}-${index}`} diff={diff} t={t} />
      ))}
    </div>
  );
}

export function HistoryEventCard({ event, onRollback, rollingBack, t }: {
  event: NormalizedHistoryEvent;
  onRollback: (eventId: number) => void;
  rollingBack: boolean;
  t: Translate;
}): React.JSX.Element {
  const createdAt = formatDate(event.created_at, t);

  return (
    <article className="overflow-hidden rounded-xl border border-separator-thin bg-bg-elevated shadow-card">
      <header className="flex items-center justify-between gap-3 border-b border-separator-thin px-3 py-2 md:px-4">
        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <Badge tone={badgeTone(event.event_type)}>{t(event.event_type)}</Badge>
          <span className="min-w-0 truncate font-medium text-txt-primary">{event.summary}</span>
          <span className="inline-flex items-center gap-1.5 text-txt-tertiary">
            <ChannelAvatar clientType={event.client_type} size={18} elevated />
            <span>{t(clientTypeLabel(event.client_type))}</span>
          </span>
          <span className="text-txt-quaternary">#{event.id}</span>
          <span className="text-txt-quaternary">·</span>
          <time className="text-txt-tertiary">{createdAt}</time>
          {event.is_rollback ? <Badge tone="purple">{t('Rollback')}</Badge> : null}
        </div>
        {event.rollback_supported ? (
          <Button
            disabled={rollingBack}
            size="sm"
            variant="ghost"
            onClick={() => onRollback(event.id)}
          >
            <RotateCcw size={14} /> {rollingBack ? t('Restoring…') : t('Rollback')}
          </Button>
        ) : null}
      </header>
      <div className="px-3 py-2 md:px-4 md:py-3">
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-txt-tertiary">
          <span>{t('Source')}: <span className="text-txt-secondary">{event.source || t('Unknown source')}</span></span>
          <span>{t('Session')}: <span className="text-txt-secondary">{event.session_id || '—'}</span></span>
        </div>
        <EventDiffs diffs={event.diffs} t={t} />
      </div>
    </article>
  );
}

export default function MemoryHistoryPage(): React.JSX.Element {
  const { t } = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm, toast } = useConfirm();
  const domain = readStringParam(searchParams, 'domain', 'core');
  const path = readStringParam(searchParams, 'path', '');
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<number | null>(null);

  const memoryHref = useMemo(() => buildUrlWithSearchParams('/memory', searchParams, { domain, path }, { path: '' }), [domain, path, searchParams]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/browse/history', { params: { domain, path } });
      setData(response.data as HistoryPayload);
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || t('Failed to load node history'));
    } finally {
      setLoading(false);
    }
  }, [domain, path, t]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleRollback = useCallback(async (eventId: number) => {
    const ok = await confirm({
      message: t('Rollback this node to the selected history event?'),
      destructive: true,
      confirmLabel: t('Rollback'),
    });
    if (!ok) return;

    setRollingBackId(eventId);
    try {
      await api.post('/browse/history', { event_id: eventId }, { params: { domain, path } });
      toast(t('Rollback completed'), 'success');
      await loadHistory();
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      toast(axiosErr.response?.data?.detail || axiosErr.message || t('Rollback failed'));
    } finally {
      setRollingBackId(null);
    }
  }, [confirm, domain, loadHistory, path, t, toast]);

  const title = data?.uri || `${domain}://${path}`;

  return (
    <PageCanvas maxWidth="6xl">
      <PageTitle
        eyebrow={t('Memory History')}
        title={t('History')}
        description={title}
        right={
          <Button variant="secondary" onClick={() => router.push(memoryHref)}>
            <ArrowLeft size={14} /> {t('Back to memory')}
          </Button>
        }
      />

      {loading ? (
        <div className="animate-in space-y-4">
          <div className="h-28 rounded-2xl skeleton" />
          <div className="h-44 rounded-2xl skeleton" />
          <div className="h-44 rounded-2xl skeleton" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
          <p className="text-[16px] text-sys-red">{error}</p>
          <Button variant="secondary" onClick={() => void loadHistory()}>{t('Try Again')}</Button>
        </div>
      ) : !data?.events.length ? (
        <Empty
          text={t('No history events for this node.')}
          title={t('No data yet.')}
          action={<Button variant="secondary" onClick={() => router.push(memoryHref)}>{t('Back to memory')}</Button>}
        />
      ) : (
        <div className="space-y-4">
          {data.events.map((event) => (
            <HistoryEventCard
              key={event.id}
              event={event}
              rollingBack={rollingBackId === event.id}
              onRollback={handleRollback}
              t={t}
            />
          ))}
        </div>
      )}
    </PageCanvas>
  );
}

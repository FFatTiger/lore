'use client';

import React, { useEffect, useMemo, useState, ReactNode } from 'react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import {
  PageCanvas, PageTitle, Card, Section, Button, Badge, Table, StatCard, Notice, inputClass, AppSelect, Disclosure, SegmentedTabs,
  fmt, trunc, asNumber,
} from '../../components/ui';
import RecallStages from '../../components/RecallStages';
import { ChannelAvatar } from '../../components/UpdaterDisplay';
import { clientTypeLabel, KNOWN_CLIENT_TYPES } from '../../components/clientTypeMeta';
import { useT } from '../../lib/i18n';
import { AxiosError } from 'axios';

interface Filters {
  days: number | string;
  limit: number | string;
  recentQueriesLimit: number | string;
  recentQueriesOffset: number;
  queryText: string;
  queryId: string;
  nodeUri: string;
  clientType: string;
}

const DEFAULT_FILTERS: Filters = {
  days: 14,
  limit: 12,
  recentQueriesLimit: 20,
  recentQueriesOffset: 0,
  queryText: '',
  queryId: '',
  nodeUri: '',
  clientType: '',
};

type RowData = Record<string, unknown>;

interface RecentQueriesBlock {
  items: RowData[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

function ClientAvatarLabel({ clientType, compact = false }: { clientType: unknown; compact?: boolean }): React.JSX.Element {
  const label = clientTypeLabel(clientType);
  const size = compact ? 22 : 24;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <ChannelAvatar clientType={typeof clientType === 'string' ? clientType : null} size={size} elevated />
      {!compact && <span className="truncate text-[12px] font-medium text-txt-secondary">{label}</span>}
    </span>
  );
}

function formatRangeLabel(offset: number, count: number, total: number): string {
  if (total <= 0 || count <= 0) return '0–0';
  return `${offset + 1}–${offset + count}`;
}

export default function RecallDrilldown(): React.JSX.Element {
  const { t } = useT();
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [aggTab, setAggTab] = useState('path');
  const [auxOpen, setAuxOpen] = useState(false);

  async function loadStats(f: Filters = filters) {
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/browse/recall/stats', {
        params: {
          days: asNumber(f.days, 14),
          limit: asNumber(f.limit, 12),
          recent_queries_limit: asNumber(f.recentQueriesLimit, 20),
          recent_queries_offset: Math.max(0, Number(f.recentQueriesOffset) || 0),
          query_id: f.queryId || undefined,
          query_text: f.queryText || undefined,
          node_uri: f.nodeUri || undefined,
          client_type: f.clientType || undefined,
        },
      });
      setStats(data);
    } catch (e) {
      const axiosErr = e as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || t('Failed to load'));
    }
    finally { setLoading(false); }
  }

  useEffect(() => {
    loadStats(filters);
  }, [filters.days, filters.limit, filters.recentQueriesLimit, filters.recentQueriesOffset, filters.queryId, filters.queryText, filters.nodeUri, filters.clientType]);

  const patch = (p: Partial<Filters>) => setFilters((prev) => {
    const next = { ...prev, ...p };
    if (
      ('days' in p)
      || ('queryText' in p)
      || ('queryId' in p)
      || ('nodeUri' in p)
      || ('clientType' in p)
      || ('recentQueriesLimit' in p)
    ) {
      next.recentQueriesOffset = 'recentQueriesOffset' in p ? Number(p.recentQueriesOffset) || 0 : 0;
    }
    return next;
  });

  const queryDetail = (stats?.query_detail as Record<string, unknown>) || null;
  const nodeDetail = (stats?.node_detail as Record<string, unknown>) || null;

  const recentQueryCols = useMemo(() => [
    { key: 'query_text', label: t('Query'), className: 'w-[40%]', render: (v: unknown) => (
      <div className="max-w-[20rem] text-[14px] font-medium leading-snug text-txt-primary">{trunc(v, 140)}</div>
    ) },
    { key: 'client_type', label: t('Source'), className: 'w-[8.5rem]', render: (v: unknown) => <ClientAvatarLabel clientType={v} compact /> },
    { key: 'shown_count', label: t('Shown'), className: 'w-[6.5rem] text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-sys-blue text-right">{String(v ?? '—')}</span> },
    { key: 'used_count', label: t('Used'), className: 'w-[6.5rem] text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-sys-green text-right">{String(v ?? '—')}</span> },
    { key: 'created_at', label: t('When'), className: 'w-[11rem] text-right', render: (v: unknown) => (
      <span className="block whitespace-nowrap text-[12px] text-right text-txt-tertiary">{v ? new Date(String(v)).toLocaleString() : '—'}</span>
    ) },
  ], [t]);

  const nodeQueryCols = useMemo(() => [
    { key: 'query_text', label: t('Query'), className: 'w-[24%]', render: (v: unknown) => <div className="max-w-[14rem] text-[13px] text-txt-primary">{trunc(v, 160)}</div> },
    { key: 'total', label: t('Events'), className: 'w-[7rem] text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-txt-secondary text-right">{String(v ?? '—')}</span> },
    { key: 'selected', label: t('Shown'), className: 'w-[7rem] text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-sys-blue text-right">{String(v ?? '—')}</span> },
    { key: 'used_in_answer', label: t('Used'), className: 'w-[7rem] text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-sys-green text-right">{String(v ?? '—')}</span> },
    { key: 'avg_final_rank_score', label: t('Avg'), className: 'w-[7.5rem] text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-txt-secondary text-right">{fmt(v)}</span> },
    { key: '_drill', label: '', className: 'w-[5.5rem] text-right', render: (_: unknown, row: RowData) => (
      <button onClick={(e) => { e.stopPropagation(); patch({ queryId: String(row.query_id || ''), queryText: '', nodeUri: '' }); }}
        className="text-[11px] text-sys-blue hover:opacity-80">{t('Open')} →</button>
    ) },
  ], [t]);

  const eventCols = useMemo(() => [
    { key: 'created_at', label: t('When'), render: (v: unknown) => <span className="text-[11px] text-txt-tertiary">{v ? new Date(String(v)).toLocaleString() : '—'}</span> },
    { key: 'query_text', label: t('Query'), render: (v: unknown) => <div className="max-w-[22rem] text-[12.5px] text-txt-primary">{trunc(v, 100)}</div> },
    { key: 'node_uri', label: t('Entry'), render: (v: unknown) => <div className="max-w-[18rem] break-all font-mono text-[11px] text-txt-primary">{String(v ?? '—')}</div> },
    { key: 'retrieval_path', label: t('Path'), render: (v: unknown, row: RowData) => (
      <div className="flex items-center gap-1.5 text-[11px]">
        <Badge tone="default">{String(v ?? '')}</Badge>
        {!!row.view_type && <span className="text-txt-tertiary">{String(row.view_type)}</span>}
        {!!row.selected && <Badge tone="blue">{t('Shown')}</Badge>}
        {!!row.used_in_answer && <Badge tone="green">{t('Used')}</Badge>}
      </div>
    ) },
    { key: 'final_rank_score', label: t('Score'), render: (v: unknown) => <span className="font-mono tabular-nums text-sys-blue">{fmt(v)}</span> },
  ], [t]);

  const noisyNodeCols = useMemo(() => [
    { key: 'node_uri', label: t('Entry'), render: (v: unknown) => <span className="break-all font-mono text-[11.5px] text-txt-primary">{String(v ?? '—')}</span> },
    { key: 'total', label: t('Events'), render: (v: unknown) => <span className="font-mono tabular-nums text-txt-secondary">{String(v ?? '—')}</span> },
    { key: 'selected', label: t('Shown'), render: (v: unknown) => <span className="font-mono tabular-nums text-sys-blue">{String(v ?? '—')}</span> },
    { key: 'avg_final_rank_score', label: t('Avg'), render: (v: unknown) => <span className="font-mono tabular-nums text-txt-secondary">{fmt(v)}</span> },
    { key: '_drill', label: '', render: (_: unknown, row: RowData) => (
      <button onClick={(e) => { e.stopPropagation(); patch({ queryId: '', queryText: '', nodeUri: String(row.node_uri || '') }); }}
        className="text-[11px] text-sys-blue hover:opacity-80">{t('Open')} →</button>
    ) },
  ], [t]);

  const recentQueriesBlock = (stats?.recent_queries as RecentQueriesBlock) || { items: [], total: 0, limit: asNumber(filters.recentQueriesLimit, 20), offset: filters.recentQueriesOffset, has_more: false };
  const recentQueries = recentQueriesBlock.items || [];
  const recentQueriesRange = formatRangeLabel(recentQueriesBlock.offset, recentQueries.length, recentQueriesBlock.total);
  const sourceOptions = useMemo(() => KNOWN_CLIENT_TYPES.map((value) => ({ value, label: clientTypeLabel(value) })), []);

  function renderAgg(): ReactNode {
    switch (aggTab) {
      case 'path':
        return (
          <Table columns={[
            { key: 'retrieval_path', label: t('Path'), render: (v: unknown) => <Badge tone="default">{String(v ?? '')}</Badge> },
            { key: 'total', label: t('Events'), render: (v: unknown) => <span className="font-mono tabular-nums text-txt-secondary">{String(v ?? '—')}</span> },
            { key: 'selected', label: t('Shown'), render: (v: unknown) => <span className="font-mono tabular-nums text-sys-blue">{String(v ?? '—')}</span> },
            { key: 'avg_final_rank_score', label: t('Avg'), render: (v: unknown) => <span className="font-mono tabular-nums text-txt-secondary">{fmt(v)}</span> },
          ]} rows={stats?.by_path as RowData[]} empty={t('No path statistics.')} />
        );
      case 'view':
        return (
          <Table columns={[
            { key: 'view_type', label: t('View'), render: (v: unknown) => <Badge tone="default">{String(v ?? '')}</Badge> },
            { key: 'total', label: t('Events'), render: (v: unknown) => <span className="font-mono tabular-nums text-txt-secondary">{String(v ?? '—')}</span> },
            { key: 'selected', label: t('Shown'), render: (v: unknown) => <span className="font-mono tabular-nums text-sys-blue">{String(v ?? '—')}</span> },
            { key: 'avg_final_rank_score', label: t('Avg'), render: (v: unknown) => <span className="font-mono tabular-nums text-txt-secondary">{fmt(v)}</span> },
          ]} rows={stats?.by_view_type as RowData[]} empty={t('No view statistics.')} />
        );
      case 'noisy':
        return <Table columns={noisyNodeCols} rows={stats?.noisy_nodes as RowData[]} empty={t('No noisy nodes.')} />;
      default:
        return null;
    }
  }

  return (
    <PageCanvas maxWidth="5xl">
      <PageTitle
        eyebrow={t('Recall')}
        title={t('Analytics')}
        titleText={t('Analytics')}
        truncateTitle
        description={`${t('Recent queries')} · ${filters.days} ${t('days')}`}
        right={
          <Button variant="ghost" onClick={() => loadStats(filters)} disabled={loading}>
            {loading ? t('Loading…') : t('Refresh')}
          </Button>
        }
      />

      {/* overview stats */}
      <div className="animate-in stagger-1 mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        {(
          [
            [t('Merged'), (stats?.summary as Record<string, unknown>)?.merged_count, 'default'],
            [t('Shown'), (stats?.summary as Record<string, unknown>)?.shown_count, 'blue'],
            [t('Queries'), (stats?.summary as Record<string, unknown>)?.query_count, 'purple'],
            [t('Used'), (stats?.summary as Record<string, unknown>)?.used_count, 'green'],
          ] as [string, unknown, 'default' | 'blue' | 'purple' | 'green'][]
        ).map(([label, value, tone]) => (
          <StatCard key={label} label={label} value={String(value ?? '—')} tone={tone} compact />
        ))}
      </div>

      {/* filter bar */}
      <div className="animate-in stagger-2 mb-5">
        <Disclosure
          open={filterOpen}
          onOpenChange={setFilterOpen}
          trigger={
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-sys-blue hover:opacity-80">
              {filterOpen ? `− ${t('Hide filters')}` : `+ ${t('Show filters')}`}
            </span>
          }
        >
          <Card className="mt-3" padded={false}>
            <div className="p-5 grid gap-x-6 gap-y-4 md:grid-cols-5">
              <label className="block">
                <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Days')}</span>
                <input type="number" value={String(filters.days)} onChange={(e) => patch({ days: e.target.value })} className={inputClass + ' tabular-nums'} />
              </label>
              <label className="block">
                <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Limit')}</span>
                <input type="number" value={String(filters.limit)} onChange={(e) => patch({ limit: e.target.value })} className={inputClass + ' tabular-nums'} />
              </label>
              <label className="block">
                <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Source')}</span>
                <AppSelect
                  value={filters.clientType}
                  onValueChange={(value) => patch({ clientType: value })}
                  options={[{ value: '', label: t('All sources') }, ...sourceOptions]}
                  className="font-sans"
                />
              </label>
              <label className="block">
                <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Query text')}</span>
                <input value={filters.queryText} onChange={(e) => patch({ queryText: e.target.value, queryId: '' })} placeholder={t('Fragment…')} className={inputClass} />
              </label>
              <label className="block">
                <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Node URI')}</span>
                <input value={filters.nodeUri} onChange={(e) => patch({ nodeUri: e.target.value })} placeholder={t('uri…')} className={inputClass} />
              </label>
            </div>
            <div className="px-5 pb-4 flex justify-end">
              <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-[12px] text-sys-blue hover:opacity-80">{t('Reset filters')}</button>
            </div>
          </Card>
        </Disclosure>
      </div>

      {error && (
        <Notice tone="danger" className="animate-scale mb-4">
          {error}
        </Notice>
      )}

      {/* main content */}
      <div className="animate-in stagger-3">
        {queryDetail ? (
          <Section
            title={trunc(String(queryDetail.query_text || queryDetail.query || ''), 80)}
            subtitle={
              <span className="inline-flex min-w-0 items-center gap-2">
                <ClientAvatarLabel clientType={queryDetail.client_type} />
                <span className="min-w-0 truncate text-txt-secondary" title={String(queryDetail.query_text || queryDetail.query || '')}>{`${queryDetail.merged_count} ${t('Merged')} · ${queryDetail.shown_count} ${t('Shown')} · ${queryDetail.used_count} ${t('Used')}`}</span>
              </span>
            }
            right={
              <Button variant="ghost" onClick={() => patch({ queryId: '', queryText: '', nodeUri: '' })}>
                ← {t('Back')}
              </Button>
            }
          >
            <RecallStages
              data={queryDetail as Parameters<typeof RecallStages>[0]['data']}
              initialStage="merge"
              hideMergedBreakdownColumn
            />
          </Section>
        ) : nodeDetail ? (
          <Section
            title={<code className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[15px] text-txt-primary" title={String(nodeDetail.node_uri ?? '')}>{String(nodeDetail.node_uri ?? '')}</code>}
            subtitle={`${nodeDetail.merged_count} ${t('Merged')} · ${nodeDetail.shown_count} ${t('Shown')}`}
            right={
              <Button variant="ghost" onClick={() => patch({ queryId: '', queryText: '', nodeUri: '' })}>
                ← {t('Back')}
              </Button>
            }
          >
            <Table columns={nodeQueryCols} rows={(nodeDetail.queries as RowData[]) || []} empty={t('No queries for this node.')} />
          </Section>
        ) : (
          <Section
            title={t('Recent queries')}
            subtitle={`${recentQueriesBlock.total}`}
          >
            <Table
              columns={recentQueryCols}
              rows={recentQueries}
              empty={t('No queries recorded yet.')}
              onRowClick={(row) => patch({ queryId: String(row.query_id || ''), queryText: '', nodeUri: '' })}
            />
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-[12px] text-txt-secondary">
                {t('Showing range')} {recentQueriesRange} {t('of')} {recentQueriesBlock.total}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={recentQueriesBlock.offset <= 0}
                  onClick={() => patch({ recentQueriesOffset: Math.max(0, recentQueriesBlock.offset - recentQueriesBlock.limit) })}
                >
                  {t('Previous')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!recentQueriesBlock.has_more}
                  onClick={() => patch({ recentQueriesOffset: recentQueriesBlock.offset + recentQueriesBlock.limit })}
                >
                  {t('Next')}
                </Button>
              </div>
            </div>
          </Section>
        )}
      </div>

      {/* auxiliary data */}
      <div className="animate-in stagger-4 mt-5">
        <Disclosure
          open={auxOpen}
          onOpenChange={setAuxOpen}
          trigger={
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-txt-secondary hover:text-txt-primary">
              {auxOpen ? `− ${t('Hide appendix')}` : `+ ${t('Show appendix')}`}
            </span>
          }
        >
          <div className="mt-3 space-y-5">
            <Card padded={false}>
              <div className="px-5 pt-4 pb-3 border-b border-separator-thin">
                <SegmentedTabs
                  value={aggTab}
                  onValueChange={setAggTab}
                  options={[['path', t('By path')], ['view', t('By view')], ['noisy', t('Noisy nodes')]].map(([value, label]) => ({ value, label }))}
                />
              </div>
              <div className="p-5">{renderAgg()}</div>
            </Card>
            <div>
              <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Raw events')}</div>
              <Table columns={eventCols} rows={stats?.recent_events as RowData[]} empty={t('No events yet.')} />
            </div>
          </div>
        </Disclosure>
      </div>
    </PageCanvas>
  );
}

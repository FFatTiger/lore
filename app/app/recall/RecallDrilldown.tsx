'use client';

import React, { useEffect, useMemo, useState, ReactNode } from 'react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import {
  PageCanvas, PageTitle, Card, Section, Button, Badge, Table, inputClass,
  fmt, trunc, asNumber,
} from '../../components/ui';
import RecallStages, { clientTypeTone, clientTypeLabel } from '../../components/RecallStages';
import { useT } from '../../lib/i18n';
import { AxiosError } from 'axios';

interface Filters {
  days: number | string;
  limit: number | string;
  queryText: string;
  queryId: string;
  nodeUri: string;
}

const DEFAULT_FILTERS: Filters = { days: 14, limit: 12, queryText: '', queryId: '', nodeUri: '' };

type RowData = Record<string, unknown>;

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
        params: { days: asNumber(f.days, 14), limit: asNumber(f.limit, 12), query_id: f.queryId || undefined, query_text: f.queryText || undefined, node_uri: f.nodeUri || undefined },
      });
      setStats(data);
    } catch (e) {
      const axiosErr = e as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || 'Failed to load');
    }
    finally { setLoading(false); }
  }

  useEffect(() => { loadStats(filters); }, [filters.days, filters.limit, filters.queryId, filters.queryText, filters.nodeUri]);

  const patch = (p: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...p }));

  const queryDetail = (stats?.query_detail as Record<string, unknown>) || null;
  const nodeDetail = (stats?.node_detail as Record<string, unknown>) || null;

  const recentQueryCols = useMemo(() => [
    { key: 'query_text', label: t('Query'), render: (v: unknown) => (
      <div className="max-w-[32rem] text-[14px] font-medium leading-snug text-txt-primary">{trunc(v, 140)}</div>
    ) },
    { key: 'client_type', label: t('Source'), render: (v: unknown) => <Badge tone={clientTypeTone(v)}>{clientTypeLabel(v)}</Badge> },
    { key: 'shown_count', label: t('Shown'), render: (v: unknown) => <span className="font-mono tabular-nums text-sys-blue">{String(v ?? '—')}</span> },
    { key: 'used_count', label: t('Used'), render: (v: unknown) => <span className="font-mono tabular-nums text-sys-green">{String(v ?? '—')}</span> },
    { key: 'created_at', label: t('When'), render: (v: unknown) => (
      <span className="text-[12px] text-txt-tertiary">{v ? new Date(String(v)).toLocaleString() : '—'}</span>
    ) },
  ], [t]);

  const nodeQueryCols = useMemo(() => [
    { key: 'query_text', label: t('Query'), render: (v: unknown) => <div className="max-w-[24rem] text-[13px] text-txt-primary">{trunc(v, 160)}</div> },
    { key: 'total', label: t('Events'), render: (v: unknown) => <span className="font-mono tabular-nums text-txt-secondary">{String(v ?? '—')}</span> },
    { key: 'selected', label: t('Shown'), render: (v: unknown) => <span className="font-mono tabular-nums text-sys-blue">{String(v ?? '—')}</span> },
    { key: 'used_in_answer', label: t('Used'), render: (v: unknown) => <span className="font-mono tabular-nums text-sys-green">{String(v ?? '—')}</span> },
    { key: 'avg_final_rank_score', label: t('Avg'), render: (v: unknown) => <span className="font-mono tabular-nums text-txt-secondary">{fmt(v)}</span> },
    { key: '_drill', label: '', render: (_: unknown, row: RowData) => (
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

  const recentQueries = (stats?.recent_queries as RowData[]) || [];

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
        description={`${t('Recent queries')} · ${filters.days}d`}
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
          ] as [string, unknown, string][]
        ).map(([label, value, tone]) => (
          <div key={label} className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-card px-5 py-4">
            <div className="text-[11px] font-medium text-txt-tertiary">{label}</div>
            <div className={clsx('mt-1.5 text-[28px] font-bold leading-none tracking-tight tabular-nums', {
              'text-txt-primary': tone === 'default',
              'text-sys-blue': tone === 'blue',
              'text-sys-purple': tone === 'purple',
              'text-sys-green': tone === 'green',
            })}>
              {String(value ?? '—')}
            </div>
          </div>
        ))}
      </div>

      {/* filter bar */}
      <div className="animate-in stagger-2 mb-5">
        <button
          onClick={() => setFilterOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-sys-blue hover:opacity-80"
        >
          {filterOpen ? `− ${t('Hide filters')}` : `+ ${t('Show filters')}`}
        </button>
        {filterOpen && (
          <Card className="mt-3" padded={false}>
            <div className="p-5 grid gap-x-6 gap-y-4 md:grid-cols-4">
              <label className="block">
                <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Days')}</span>
                <input type="number" value={String(filters.days)} onChange={(e) => patch({ days: e.target.value })} className={inputClass + ' tabular-nums'} />
              </label>
              <label className="block">
                <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Limit')}</span>
                <input type="number" value={String(filters.limit)} onChange={(e) => patch({ limit: e.target.value })} className={inputClass + ' tabular-nums'} />
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
        )}
      </div>

      {error && (
        <div className="animate-scale mb-4 rounded-xl bg-sys-red/10 border border-sys-red/20 px-3.5 py-2.5 text-[13px] text-sys-red">
          {error}
        </div>
      )}

      {/* main content */}
      <div className="animate-in stagger-3">
        {queryDetail ? (
          <Section
            title={trunc(String(queryDetail.query_text || queryDetail.query || ''), 80)}
            subtitle={
              <span className="inline-flex items-center gap-2">
                <Badge tone={clientTypeTone(queryDetail.client_type)}>{clientTypeLabel(queryDetail.client_type)}</Badge>
                <span className="text-txt-secondary">{`${queryDetail.merged_count} ${t('Merged')} · ${queryDetail.shown_count} ${t('Shown')} · ${queryDetail.used_count} ${t('Used')}`}</span>
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
              showClientSource
              hideMergedBreakdownColumn
            />
          </Section>
        ) : nodeDetail ? (
          <Section
            title={<code className="font-mono text-[15px] text-txt-primary break-all">{String(nodeDetail.node_uri ?? '')}</code>}
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
            subtitle={`${recentQueries.length}`}
          >
            <Table
              columns={recentQueryCols}
              rows={recentQueries}
              empty={t('No queries recorded yet.')}
              onRowClick={(row) => patch({ queryId: String(row.query_id || ''), queryText: '', nodeUri: '' })}
            />
          </Section>
        )}
      </div>

      {/* auxiliary data */}
      <div className="animate-in stagger-4 mt-5">
        <button
          onClick={() => setAuxOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-txt-secondary hover:text-txt-primary"
        >
          {auxOpen ? `− ${t('Hide appendix')}` : `+ ${t('Show appendix')}`}
        </button>
        {auxOpen && (
          <div className="mt-3 space-y-5">
            <Card padded={false}>
              <div className="px-5 pt-4 pb-3 border-b border-separator-thin flex items-center gap-1">
                {([['path', t('By path')], ['view', t('By view')], ['noisy', t('Noisy nodes')]] as [string, string][]).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setAggTab(k)}
                    className={clsx(
                      'press rounded-full px-3 py-1 text-[12px] font-medium transition-all',
                      aggTab === k ? 'bg-fill-primary text-txt-primary' : 'text-txt-secondary hover:text-txt-primary hover:bg-fill-quaternary',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="p-5">{renderAgg()}</div>
            </Card>
            <div>
              <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Raw events')}</div>
              <Table columns={eventCols} rows={stats?.recent_events as RowData[]} empty={t('No events yet.')} />
            </div>
          </div>
        )}
      </div>
    </PageCanvas>
  );
}

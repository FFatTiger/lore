'use client';

import React, { useEffect, useMemo, useState, ReactNode, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { buildUrlWithSearchParams, readNumberParam, readStringParam } from '../../lib/url-state';

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const filters = useMemo<Filters>(() => ({
    days: readNumberParam(searchParams, 'days', 14, { min: 1 }),
    limit: readNumberParam(searchParams, 'limit', 12, { min: 1 }),
    recentQueriesLimit: readNumberParam(searchParams, 'recent_queries_limit', 20, { min: 1 }),
    recentQueriesOffset: readNumberParam(searchParams, 'recent_queries_offset', 0, { min: 0 }),
    queryText: readStringParam(searchParams, 'query_text'),
    queryId: readStringParam(searchParams, 'query_id'),
    nodeUri: readStringParam(searchParams, 'node_uri'),
    clientType: readStringParam(searchParams, 'client_type'),
  }), [searchParams]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [aggTab, setAggTab] = useState('path');
  const [auxOpen, setAuxOpen] = useState(false);

  const applyFilters = useCallback((patch: Partial<Filters>, mode: 'push' | 'replace' = 'replace') => {
    const next: Filters = { ...filters, ...patch };
    if (
      patch.days !== undefined
      || patch.queryText !== undefined
      || patch.queryId !== undefined
      || patch.nodeUri !== undefined
      || patch.clientType !== undefined
      || patch.recentQueriesLimit !== undefined
    ) {
      next.recentQueriesOffset = patch.recentQueriesOffset !== undefined ? Number(patch.recentQueriesOffset) || 0 : 0;
    }
    const href = buildUrlWithSearchParams('/recall/drilldown', searchParams, {
      days: next.days,
      limit: next.limit,
      recent_queries_limit: next.recentQueriesLimit,
      recent_queries_offset: next.recentQueriesOffset,
      query_id: next.queryId,
      query_text: next.queryText,
      node_uri: next.nodeUri,
      client_type: next.clientType,
    }, {
      days: DEFAULT_FILTERS.days,
      limit: DEFAULT_FILTERS.limit,
      recent_queries_limit: DEFAULT_FILTERS.recentQueriesLimit,
      recent_queries_offset: DEFAULT_FILTERS.recentQueriesOffset,
      query_id: DEFAULT_FILTERS.queryId,
      query_text: DEFAULT_FILTERS.queryText,
      node_uri: DEFAULT_FILTERS.nodeUri,
      client_type: DEFAULT_FILTERS.clientType,
    });
    if (mode === 'push') router.push(href);
    else router.replace(href);
  }, [filters, router, searchParams]);

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

  const queryDetail = (stats?.query_detail as Record<string, unknown>) || null;
  const nodeDetail = (stats?.node_detail as Record<string, unknown>) || null;
  const runtime = (stats?.runtime as Record<string, unknown>) || null;
  const runtimeDisplay = (runtime?.display as Record<string, unknown>) || null;
  const displayThresholdAnalysis = (stats?.display_threshold_analysis as Record<string, unknown>) || null;
  const clientTypeThresholdAnalysis = (stats?.client_type_threshold_analysis as RowData[]) || [];
  const thresholdStatus = String(displayThresholdAnalysis?.status || 'insufficient_data');
  const thresholdStatusDetail = String(displayThresholdAnalysis?.status_detail || 'insufficient_data');
  const thresholdExecutionStatus = String(displayThresholdAnalysis?.execution_status || 'not_applicable');
  const thresholdReady = thresholdStatus === 'ready';
  const thresholdUnsafe = thresholdStatusDetail === 'ready_but_unsafe' || thresholdExecutionStatus === 'blocked';
  const thresholdEligible = thresholdStatusDetail === 'ready_to_review' && thresholdExecutionStatus === 'eligible';
  const thresholdBasis = String(displayThresholdAnalysis?.basis || 'insufficient_data').split('_').join(' ');
  const currentMinDisplayScore = runtimeDisplay?.min_display_score;
  const suggestedMinDisplayScore = displayThresholdAnalysis?.suggested_min_display_score;
  const currentMinDisplayScoreNumber = Number(currentMinDisplayScore);
  const suggestedMinDisplayScoreNumber = Number(suggestedMinDisplayScore);
  const thresholdDelta = Number.isFinite(currentMinDisplayScoreNumber) && Number.isFinite(suggestedMinDisplayScoreNumber)
    ? suggestedMinDisplayScoreNumber - currentMinDisplayScoreNumber
    : null;

  const recentQueryCols = useMemo(() => [
    { key: 'query_text', label: t('Query'), className: 'w-[60%]', render: (v: unknown) => (
      <div className="max-w-full text-[14px] font-medium leading-snug text-txt-primary">{trunc(v, 140)}</div>
    ) },
    { key: 'client_type', label: t('Source'), className: 'text-center', render: (v: unknown) => <div className="flex justify-center"><ClientAvatarLabel clientType={v} compact /></div> },
    { key: 'shown_count', label: t('Shown'), className: 'text-center', render: (v: unknown) => <span className="block font-mono tabular-nums text-sys-blue text-center">{String(v ?? '—')}</span> },
    { key: 'used_count', label: t('Used'), className: 'text-center', render: (v: unknown) => <span className="block font-mono tabular-nums text-sys-green text-center">{String(v ?? '—')}</span> },
    { key: 'created_at', label: t('When'), className: 'w-[8.5rem] text-right', render: (v: unknown) => (
      <span className="block whitespace-nowrap text-[12px] text-right text-txt-tertiary">{v ? new Date(String(v)).toLocaleString() : '—'}</span>
    ) },
  ], [t]);

  const nodeQueryCols = useMemo(() => [
    { key: 'query_text', label: t('Query'), className: 'w-[60%]', render: (v: unknown) => <div className="max-w-full text-[13px] text-txt-primary">{trunc(v, 160)}</div> },
    { key: 'total', label: t('Events'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-txt-secondary text-right">{String(v ?? '—')}</span> },
    { key: 'selected', label: t('Shown'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-sys-blue text-right">{String(v ?? '—')}</span> },
    { key: 'used_in_answer', label: t('Used'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-sys-green text-right">{String(v ?? '—')}</span> },
    { key: 'avg_final_rank_score', label: t('Avg'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-txt-secondary text-right">{fmt(v)}</span> },
    { key: '_drill', label: '', className: 'text-right', render: (_: unknown, row: RowData) => (
      <button onClick={(e) => { e.stopPropagation(); applyFilters({ queryId: String(row.query_id || ''), queryText: '', nodeUri: '' }, 'push'); }}
        className="text-[11px] text-sys-blue hover:opacity-80">{t('Open')} →</button>
    ) },
  ], [applyFilters, t]);

  const eventCols = useMemo(() => [
    { key: 'created_at', label: t('When'), className: 'w-[8rem] text-right', render: (v: unknown) => <span className="block whitespace-nowrap text-[11px] text-right text-txt-tertiary">{v ? new Date(String(v)).toLocaleString() : '—'}</span> },
    { key: 'query_text', label: t('Query'), className: 'w-[60%]', render: (v: unknown) => <div className="max-w-full text-[12.5px] text-txt-primary">{trunc(v, 100)}</div> },
    { key: 'node_uri', label: t('Entry'), render: (v: unknown) => <div className="max-w-[18rem] break-all font-mono text-[11px] text-txt-primary">{String(v ?? '—')}</div> },
    { key: 'retrieval_path', label: t('Path'), render: (v: unknown, row: RowData) => (
      <div className="flex items-center gap-1.5 text-[11px]">
        <Badge tone="default">{String(v ?? '')}</Badge>
        {!!row.view_type && <span className="text-txt-tertiary">{String(row.view_type)}</span>}
        {!!row.selected && <Badge tone="blue">{t('Shown')}</Badge>}
        {!!row.used_in_answer && <Badge tone="green">{t('Used')}</Badge>}
      </div>
    ) },
    { key: 'final_rank_score', label: t('Score'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-sys-blue text-right">{fmt(v)}</span> },
  ], [t]);

  const noisyNodeCols = useMemo(() => [
    { key: 'node_uri', label: t('Entry'), render: (v: unknown) => <div className="max-w-[20rem] break-all font-mono text-[11.5px] text-txt-primary">{String(v ?? '—')}</div> },
    { key: 'total', label: t('Events'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-txt-secondary text-right">{String(v ?? '—')}</span> },
    { key: 'selected', label: t('Shown'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-sys-blue text-right">{String(v ?? '—')}</span> },
    { key: 'avg_final_rank_score', label: t('Avg'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-txt-secondary text-right">{fmt(v)}</span> },
    { key: '_drill', label: '', className: 'text-right', render: (_: unknown, row: RowData) => (
      <button onClick={(e) => { e.stopPropagation(); applyFilters({ queryId: '', queryText: '', nodeUri: String(row.node_uri || '') }, 'push'); }}
        className="text-[11px] text-sys-blue hover:opacity-80">{t('Open')} →</button>
    ) },
  ], [applyFilters, t]);

  const recentQueriesBlock = (stats?.recent_queries as RecentQueriesBlock) || { items: [], total: 0, limit: asNumber(filters.recentQueriesLimit, 20), offset: filters.recentQueriesOffset, has_more: false };
  const recentQueries = recentQueriesBlock.items || [];
  const recentQueriesRange = formatRangeLabel(recentQueriesBlock.offset, recentQueries.length, recentQueriesBlock.total);
  const sourceOptions = useMemo(() => [
    { value: '__legacy__', label: clientTypeLabel('__legacy__') },
    ...KNOWN_CLIENT_TYPES.map((value) => ({ value, label: clientTypeLabel(value) })),
  ], []);
  const thresholdClientRows = useMemo<RowData[]>(() => clientTypeThresholdAnalysis.map((row) => {
    const clientType = typeof row.client_type === 'string' && row.client_type.trim() ? row.client_type.trim() : '__legacy__';
    const analysis = (row.analysis as RowData) || {};
    return {
      client_type: clientType,
      label: clientType === '__legacy__' ? t('Legacy') : clientTypeLabel(clientType),
      shown_candidate_count: analysis.shown_candidate_count,
      used_candidate_count: analysis.used_candidate_count,
      used_p25_score: analysis.used_p25_score,
      unused_shown_p75_score: analysis.unused_shown_p75_score,
      separation_gap: analysis.separation_gap,
      threshold_gap: analysis.threshold_gap,
      suggested_min_display_score: analysis.suggested_min_display_score,
      status_detail: analysis.status_detail,
      execution_status: analysis.execution_status,
    };
  }), [clientTypeThresholdAnalysis, t]);
  const thresholdClientCols = useMemo(() => [
    {
      key: 'label',
      label: t('Source'),
      render: (_: unknown, row: RowData) => (
        <div className="flex items-center gap-2">
          <ClientAvatarLabel clientType={row.client_type} compact />
          <span className="text-[12px] font-medium text-txt-primary">{String(row.label || '—')}</span>
        </div>
      ),
    },
    {
      key: 'status_detail',
      label: t('Status'),
      render: (value: unknown, row: RowData) => {
        const unsafe = value === 'ready_but_unsafe' || row.execution_status === 'blocked';
        const ready = value === 'ready_to_review';
        return <Badge tone={unsafe ? 'orange' : ready ? 'green' : 'default'}>{unsafe ? t('Ready, unsafe') : ready ? t('Ready') : t('Insufficient')}</Badge>;
      },
    },
    { key: 'shown_candidate_count', label: t('Shown'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-right">{String(v ?? '—')}</span> },
    { key: 'used_candidate_count', label: t('Used'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-right">{String(v ?? '—')}</span> },
    { key: 'used_p25_score', label: t('Used p25'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-right">{fmt(v)}</span> },
    { key: 'unused_shown_p75_score', label: t('Unused p75'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-right">{fmt(v)}</span> },
    { key: 'separation_gap', label: t('Separation'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-right">{fmt(v)}</span> },
    { key: 'suggested_min_display_score', label: t('Suggested'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-right">{fmt(v)}</span> },
  ], [t]);

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
        return <Table columns={noisyNodeCols} rows={stats?.noisy_nodes as RowData[]} empty={t('No noisy nodes.')} activeRowKey={filters.nodeUri} />;
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

      <div className="animate-in stagger-2 mb-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label={t('Current threshold')}
          value={fmt(currentMinDisplayScore)}
          tone="blue"
          compact
        />
        <StatCard
          label={t('Suggested threshold')}
          value={fmt(suggestedMinDisplayScore)}
          hint={!thresholdReady
            ? t('Waiting for enough shown/used samples')
            : thresholdUnsafe
              ? t('Ready sample volume, blocked by overlap')
              : t('Analytics-backed candidate midpoint')}
          tone={!thresholdReady ? 'orange' : thresholdUnsafe ? 'orange' : 'green'}
          compact
        />
        <StatCard
          label={t('Threshold gap')}
          value={thresholdDelta == null ? '—' : `${thresholdDelta >= 0 ? '+' : ''}${fmt(thresholdDelta)}`}
          hint={t('Suggested minus current')}
          tone={thresholdDelta == null ? 'default' : thresholdDelta > 0 ? 'orange' : thresholdDelta < 0 ? 'green' : 'default'}
          compact
        />
        <StatCard
          label={t('Separation gap')}
          value={fmt(displayThresholdAnalysis?.separation_gap)}
          hint={t('Used p25 minus unused shown p75')}
          tone={!thresholdReady ? 'default' : thresholdUnsafe ? 'orange' : 'purple'}
          compact
        />
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
                <input type="number" value={String(filters.days)} onChange={(e) => applyFilters({ days: e.target.value }, 'replace')} className={inputClass + ' tabular-nums'} />
              </label>
              <label className="block">
                <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Limit')}</span>
                <input type="number" value={String(filters.limit)} onChange={(e) => applyFilters({ limit: e.target.value }, 'replace')} className={inputClass + ' tabular-nums'} />
              </label>
              <label className="block">
                <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Source')}</span>
                <AppSelect
                  value={filters.clientType}
                  onValueChange={(value) => applyFilters({ clientType: value }, 'replace')}
                  options={[{ value: '', label: t('All sources') }, ...sourceOptions]}
                  className="font-sans"
                />
              </label>
              <label className="block">
                <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Query text')}</span>
                <input value={filters.queryText} onChange={(e) => applyFilters({ queryText: e.target.value, queryId: '' }, 'replace')} placeholder={t('Fragment…')} className={inputClass} />
              </label>
              <label className="block">
                <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Node URI')}</span>
                <input value={filters.nodeUri} onChange={(e) => applyFilters({ nodeUri: e.target.value, queryId: '' }, 'replace')} placeholder={t('uri…')} className={inputClass} />
              </label>
            </div>
            <div className="px-5 pb-4 flex justify-end">
              <button onClick={() => applyFilters(DEFAULT_FILTERS, 'replace')} className="text-[12px] text-sys-blue hover:opacity-80">{t('Reset filters')}</button>
            </div>
          </Card>
        </Disclosure>
      </div>

      {error && (
        <Notice tone="danger" className="animate-scale mb-4">
          {error}
        </Notice>
      )}

      <div className="animate-in stagger-3 mb-5">
        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Display threshold analysis')}</div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={!thresholdReady ? 'default' : thresholdUnsafe ? 'orange' : 'green'}>
                  {!thresholdReady ? t('Insufficient data') : thresholdUnsafe ? t('Ready, unsafe to apply') : t('Ready to review')}
                </Badge>
                <span className="text-[12px] text-txt-secondary">{t('Basis')}: {thresholdBasis}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] text-txt-secondary md:text-right">
              <div>{t('Shown candidates')}: <span className="font-mono tabular-nums text-txt-primary">{String(displayThresholdAnalysis?.shown_candidate_count ?? '—')}</span></div>
              <div>{t('Used candidates')}: <span className="font-mono tabular-nums text-txt-primary">{String(displayThresholdAnalysis?.used_candidate_count ?? '—')}</span></div>
              <div>{t('Unused shown')}: <span className="font-mono tabular-nums text-txt-primary">{String(displayThresholdAnalysis?.unused_shown_candidate_count ?? '—')}</span></div>
              <div>{t('Used p25')}: <span className="font-mono tabular-nums text-txt-primary">{fmt(displayThresholdAnalysis?.used_p25_score)}</span></div>
              <div>{t('Unused shown p75')}: <span className="font-mono tabular-nums text-txt-primary">{fmt(displayThresholdAnalysis?.unused_shown_p75_score)}</span></div>
              <div>{t('Used median')}: <span className="font-mono tabular-nums text-txt-primary">{fmt(displayThresholdAnalysis?.used_p50_score)}</span></div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-separator-thin bg-bg-elevated px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Current')}</div>
              <div className="mt-1 font-mono text-[20px] font-semibold tabular-nums text-sys-blue">{fmt(currentMinDisplayScore)}</div>
              <div className="mt-1 text-[12px] text-txt-tertiary">{t('Runtime min_display_score')}</div>
            </div>
            <div className="rounded-xl border border-separator-thin bg-bg-elevated px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Suggested')}</div>
              <div className="mt-1 font-mono text-[20px] font-semibold tabular-nums text-sys-green">{fmt(suggestedMinDisplayScore)}</div>
              <div className="mt-1 text-[12px] text-txt-tertiary">{t('Analytics suggestion')}</div>
            </div>
            <div className="rounded-xl border border-separator-thin bg-bg-elevated px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Difference')}</div>
              <div className={clsx('mt-1 font-mono text-[20px] font-semibold tabular-nums', thresholdDelta == null ? 'text-txt-primary' : thresholdDelta > 0 ? 'text-sys-orange' : thresholdDelta < 0 ? 'text-sys-green' : 'text-txt-primary')}>
                {thresholdDelta == null ? '—' : `${thresholdDelta >= 0 ? '+' : ''}${fmt(thresholdDelta)}`}
              </div>
              <div className="mt-1 text-[12px] text-txt-tertiary">{t('Suggested minus current')}</div>
            </div>
          </div>
          {!thresholdReady && (
            <Notice tone="warning" className="mt-4">
              {t('Threshold guidance is waiting for enough shown and used candidates. Keep collecting recall events before changing the default display threshold.')}
            </Notice>
          )}
          {thresholdUnsafe && (
            <Notice tone="warning" className="mt-4" title={t('Ready sample volume, unsafe execution')}>
              {t('This window has enough shown and used candidates to compute a suggestion, but the current score overlap is still unsafe. A negative separation gap means used low-tail candidates are scoring below unused shown high-tail candidates, so directly raising the runtime threshold would likely hide memories that were actually used.')}
            </Notice>
          )}
          <div className="mt-4 border-t border-separator-thin pt-4">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('By source')}</div>
            <Table columns={thresholdClientCols} rows={thresholdClientRows} empty={t('No source-specific threshold samples yet.')} activeRowKey={filters.clientType || undefined} />
          </div>
        </Card>
      </div>

      {/* main content */}
      <div className="animate-in stagger-4">
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
              <Button variant="ghost" onClick={() => applyFilters({ queryId: '', queryText: '', nodeUri: '' }, 'replace')}>
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
              <Button variant="ghost" onClick={() => applyFilters({ queryId: '', queryText: '', nodeUri: '' }, 'replace')}>
                ← {t('Back')}
              </Button>
            }
          >
            <Table columns={nodeQueryCols} rows={(nodeDetail.queries as RowData[]) || []} empty={t('No queries for this node.')} activeRowKey={filters.queryId} />
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
              onRowClick={(row) => applyFilters({ queryId: String(row.query_id || ''), queryText: '', nodeUri: '' }, 'push')}
              activeRowKey={filters.queryId}
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
                  onClick={() => applyFilters({ recentQueriesOffset: Math.max(0, recentQueriesBlock.offset - recentQueriesBlock.limit) }, 'push')}
                >
                  {t('Previous')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!recentQueriesBlock.has_more}
                  onClick={() => applyFilters({ recentQueriesOffset: recentQueriesBlock.offset + recentQueriesBlock.limit }, 'push')}
                >
                  {t('Next')}
                </Button>
              </div>
            </div>
          </Section>
        )}
      </div>

      {/* auxiliary data */}
      <div className="animate-in stagger-5 mt-5">
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

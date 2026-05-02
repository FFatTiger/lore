'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import {
  PageCanvas, PageTitle, Section, Button, Table, StatCard, Notice, FilterNumberField, AppSelect, FilterPill,
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
  clientType: string;
}

const DEFAULT_FILTERS: Filters = {
  days: 14,
  limit: 12,
  recentQueriesLimit: 20,
  recentQueriesOffset: 0,
  queryText: '',
  queryId: '',
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
  const { t } = useT();
  const label = t(clientTypeLabel(clientType));
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
    clientType: readStringParam(searchParams, 'client_type'),
  }), [searchParams]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const applyFilters = useCallback((patch: Partial<Filters>, mode: 'push' | 'replace' = 'replace') => {
    const next: Filters = { ...filters, ...patch };
    if (
      patch.days !== undefined
      || patch.queryText !== undefined
      || patch.queryId !== undefined
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
      client_type: next.clientType,
    }, {
      days: DEFAULT_FILTERS.days,
      limit: DEFAULT_FILTERS.limit,
      recent_queries_limit: DEFAULT_FILTERS.recentQueriesLimit,
      recent_queries_offset: DEFAULT_FILTERS.recentQueriesOffset,
      query_id: DEFAULT_FILTERS.queryId,
      query_text: DEFAULT_FILTERS.queryText,
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
  }, [filters.days, filters.limit, filters.recentQueriesLimit, filters.recentQueriesOffset, filters.queryId, filters.queryText, filters.clientType]);

  const queryDetail = (stats?.query_detail as Record<string, unknown>) || null;
  const isDetailRoute = Boolean(filters.queryId);
  const clientTypeThresholdAnalysis = (stats?.client_type_threshold_analysis as RowData[]) || [];

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

  const recentQueriesBlock = (stats?.recent_queries as RecentQueriesBlock) || { items: [], total: 0, limit: asNumber(filters.recentQueriesLimit, 20), offset: filters.recentQueriesOffset, has_more: false };
  const recentQueries = recentQueriesBlock.items || [];
  const recentQueriesRange = formatRangeLabel(recentQueriesBlock.offset, recentQueries.length, recentQueriesBlock.total);
  const sourceOptions = useMemo(() => [
    { value: '__legacy__', label: t(clientTypeLabel('__legacy__')) },
    ...KNOWN_CLIENT_TYPES.map((value) => ({ value, label: t(clientTypeLabel(value)) })),
  ], [t]);
  const thresholdClientRows = useMemo<RowData[]>(() => clientTypeThresholdAnalysis
    .filter((row) => {
      const clientType = typeof row.client_type === 'string' && row.client_type.trim() ? row.client_type.trim() : '__legacy__';
      return clientType !== '__legacy__' && clientType !== 'admin';
    })
    .map((row) => {
      const clientType = typeof row.client_type === 'string' && row.client_type.trim() ? row.client_type.trim() : '__legacy__';
      const analysis = (row.analysis as RowData) || {};
      return {
        client_type: clientType,
        label: t(clientTypeLabel(clientType)),
        shown_candidate_count: analysis.shown_candidate_count,
        used_candidate_count: analysis.used_candidate_count,
        used_p25_score: analysis.used_p25_score,
        unused_shown_p75_score: analysis.unused_shown_p75_score,
        separation_gap: analysis.separation_gap,
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
    { key: 'shown_candidate_count', label: t('Shown'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-right">{String(v ?? '—')}</span> },
    { key: 'used_candidate_count', label: t('Used'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-right">{String(v ?? '—')}</span> },
    { key: 'used_p25_score', label: t('Used p25'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-right">{fmt(v)}</span> },
    { key: 'unused_shown_p75_score', label: t('Unused p75'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-right">{fmt(v)}</span> },
    { key: 'separation_gap', label: t('Separation'), className: 'text-right', render: (v: unknown) => <span className="block font-mono tabular-nums text-right">{fmt(v)}</span> },
  ], [t]);

  const titleFilters = (
    <div className="flex flex-wrap items-center gap-1">
      <FilterPill
        as="label"
        htmlFor="recall-days-filter"
        active={String(filters.days) !== String(DEFAULT_FILTERS.days)}
        className="press h-8 hover:bg-fill-quaternary focus-within:bg-fill-quaternary"
      >
        <span>{t('Days')}</span>
        <FilterNumberField
          id="recall-days-filter"
          min={1}
          value={Number(filters.days) || 1}
          onChange={(v) => applyFilters({ days: v ?? DEFAULT_FILTERS.days }, 'replace')}
        />
      </FilterPill>
      <FilterPill
        as="label"
        active={Boolean(filters.clientType)}
        className="press h-8 hover:bg-fill-quaternary focus-within:bg-fill-quaternary"
      >
        <span>{t('Source')}</span>
        <AppSelect
          variant="borderless"
          size="md"
          value={filters.clientType}
          onValueChange={(value) => applyFilters({ clientType: value }, 'replace')}
          options={[{ value: '', label: t('All sources') }, ...sourceOptions]}
          placeholder={t('All sources')}
          className="w-auto font-semibold text-txt-primary"
        />
      </FilterPill>
    </div>
  );

  return (
    <PageCanvas maxWidth="5xl">
      <PageTitle
        eyebrow={t('Recall')}
        title={t('Analytics')}
        titleText={t('Analytics')}
        truncateTitle
        description={`${t('Recent queries')} · ${filters.days} ${t('days')}`}
        right={
          <>
            {titleFilters}
            <Button variant="ghost" onClick={() => loadStats(filters)} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
              {loading ? t('Loading…') : t('Refresh')}
            </Button>
          </>
        }
      />

      {!isDetailRoute && (
        <>
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

          <div className="animate-in stagger-2 mb-5">
            <Section title={t('Display threshold analysis')}>
              <Table columns={thresholdClientCols} rows={thresholdClientRows} empty={t('No source-specific threshold samples yet.')} activeRowKey={filters.clientType || undefined} />
            </Section>
          </div>
        </>
      )}

      {error && (
        <Notice tone="danger" className="animate-scale mb-4">
          {error}
        </Notice>
      )}

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
              <Button variant="ghost" onClick={() => applyFilters({ queryId: '', queryText: '' }, 'replace')}>
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
        ) : (
          <Section
            title={t('Recent queries')}
            subtitle={`${recentQueriesBlock.total}`}
          >
            <Table
              columns={recentQueryCols}
              rows={recentQueries}
              empty={t('No queries recorded yet.')}
              onRowClick={(row) => applyFilters({ queryId: String(row.query_id || ''), queryText: '' }, 'push')}
              activeRowKey={filters.queryId}
            />
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-[12px] text-txt-secondary">
                {t('Showing range')} {recentQueriesRange} {t('of')} {recentQueriesBlock.total}
              </div>
              <div className="flex items-center gap-2">
                <Button
                 
                  variant="ghost"
                  disabled={recentQueriesBlock.offset <= 0}
                  onClick={() => applyFilters({ recentQueriesOffset: Math.max(0, recentQueriesBlock.offset - recentQueriesBlock.limit) }, 'push')}
                >
                  {t('Previous')}
                </Button>
                <Button
                 
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
    </PageCanvas>
  );
}

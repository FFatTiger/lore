'use client';

import React from 'react';
import { useT } from '../../lib/i18n';
import { PageCanvas, PageTitle, Section, Button, Badge, StatCard, Table } from '../../components/ui';
import { useConfirm } from '../../components/ConfirmDialog';
import {
  useDreamPageController,
  type DreamConfig,
  type DreamEntry,
  type DreamSummary,
} from './useDreamPageController';
import { DreamDetailView } from './DreamDetailView';

function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? `${m}m${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h${rm}m` : `${h}h`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

type BadgeStatusTone = 'green' | 'red' | 'soft' | 'blue';
type StatStatusTone = 'green' | 'red' | 'default' | 'blue';

function statusTone(s: string): BadgeStatusTone {
  if (s === 'completed') return 'green';
  if (s === 'error') return 'red';
  if (s === 'rolled_back') return 'soft';
  return 'blue';
}

function statusStatTone(s: string): StatStatusTone {
  if (s === 'completed') return 'green';
  if (s === 'error') return 'red';
  if (s === 'rolled_back') return 'default';
  return 'blue';
}

interface DreamDiaryListViewProps {
  entries: DreamEntry[];
  total: number;
  loading: boolean;
  running: boolean;
  config: DreamConfig;
  selectedId: string;
  t: (key: string) => string;
  onRun: () => void;
  onSelect: (row: Record<string, unknown>) => void;
}

function DreamDiaryListView({
  entries,
  total,
  loading,
  running,
  config,
  selectedId,
  t,
  onRun,
  onSelect,
}: DreamDiaryListViewProps): React.JSX.Element {
  const lastEntry = entries[0];
  const columns = [
    { key: 'started_at', label: t('Date'), render: (v: unknown) => <span className="whitespace-nowrap">{fmtDate(String(v || ''))}</span> },
    { key: 'status', label: t('Status'), render: (v: unknown) => <Badge className="min-w-[3.9rem] justify-center" tone={statusTone(String(v || ''))}>{t(String(v || ''))}</Badge> },
    { key: 'duration_ms', label: t('Duration'), className: 'hidden sm:table-cell text-right', render: (v: unknown) => <span className="block text-right">{fmtDuration(v as number)}</span> },
    { key: 'summary', label: t('Summary'), className: 'hidden sm:table-cell w-[30%] text-right', render: (_: unknown, row: Record<string, unknown>) => <SummaryBadges summary={row.summary as DreamSummary} t={t} /> },
  ];

  return (
    <PageCanvas size="5xl">
      <PageTitle
        eyebrow={t('Structural Audit')}
        title={t('Dream Diary')}
        titleText={t('Dream Diary')}
        truncateTitle
        description={t('Dream audits Lore structure — path placement, split needs, retrieval-path issues, and safe move/update decisions.')}
        right={
          <Button variant="primary" onClick={onRun} disabled={running}>
            {running ? t('Dreaming…') : t('Run Dream Now')}
          </Button>
        }
      />

      <div className="animate-in stagger-1 mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={t('Last Dream')} value={lastEntry ? fmtDate(lastEntry.started_at) : '—'} tone="blue" compact />
        <StatCard label={t('Total Entries')} value={total} tone="default" compact />
        <StatCard label={t('Last Status')} value={lastEntry ? t(lastEntry.status) : '—'} tone={lastEntry ? statusStatTone(lastEntry.status) : 'default'} compact />
        <StatCard
          label={t('Schedule')}
          value={config.enabled ? `${String(config.schedule_hour).padStart(2, '0')}:00` : t('Off')}
          tone={config.enabled ? 'green' : 'default'}
          compact
        />
      </div>

      <Section title={t('Dream Diary')} subtitle={`${total}`} className="mt-5">
        {loading ? (
          <div className="text-center py-8 text-txt-tertiary">{t('Loading…')}</div>
        ) : (
          <Table
            columns={columns}
            rows={entries as unknown as Record<string, unknown>[]}
            empty={t('No diary entries yet. Run your first dream!')}
            onRowClick={onSelect}
            activeRowKey={selectedId}
          />
        )}
      </Section>
    </PageCanvas>
  );
}

export default function DreamPage(): React.JSX.Element {
  const { t } = useT();
  const { confirm: confirmDialog } = useConfirm();
  const {
    selectedId,
    entries,
    total,
    loading,
    running,
    rollingBack,
    config,
    detail,
    detailLoading,
    latestRollbackId,
    handleRun,
    handleSelect,
    handleBack,
    handleRollback,
  } = useDreamPageController({ confirmDialog, t });

  if (selectedId) {
    return (
      <PageCanvas size="5xl">
        <DreamDetailView
          entry={detail}
          loading={detailLoading}
          canRollback={selectedId === latestRollbackId}
          rollingBack={rollingBack}
          onBack={handleBack}
          onRollback={() => void handleRollback(selectedId)}
          t={t}
        />
      </PageCanvas>
    );
  }

  return (
    <DreamDiaryListView
      entries={entries}
      total={total}
      loading={loading}
      running={running}
      config={config}
      selectedId={selectedId}
      t={t}
      onRun={() => void handleRun()}
      onSelect={handleSelect}
    />
  );
}

interface SummaryBadgesProps {
  summary: DreamSummary | undefined | null;
  t: (key: string) => string;
}

function SummaryBadges({ summary, t }: SummaryBadgesProps): React.JSX.Element | string {
  if (!summary) return '—';
  const parts: string[] = [];
  const agent = summary.agent;
  const recallReview = summary.recall_review;
  const durableExtraction = summary.durable_extraction;
  const structure = summary.structure;
  const activity = summary.activity;

  if (recallReview?.possible_missed_recalls) parts.push(`${t('Missed recalls')} ${recallReview.possible_missed_recalls}`);
  if (durableExtraction?.created) parts.push(`${t('Created')} ${durableExtraction.created}`);
  if (durableExtraction?.enriched) parts.push(`${t('Enriched')} ${durableExtraction.enriched}`);
  if (structure?.moved) parts.push(`${t('Moved')} ${structure.moved}`);
  if (structure?.protected_blocks) parts.push(`${t('Protected')} ${structure.protected_blocks}`);
  if (structure?.policy_blocks) parts.push(`${t('Policy blocks')} ${structure.policy_blocks}`);
  if (structure?.policy_warnings) parts.push(`${t('Policy warnings')} ${structure.policy_warnings}`);
  if (activity?.reviewed_queries) parts.push(`${t('Reviewed queries')} ${activity.reviewed_queries}`);
  if (activity?.write_events) parts.push(`${t('Write events')} ${activity.write_events}`);
  if (agent?.tool_calls != null) parts.push(`${agent.tool_calls} ${t('calls')}`);

  return <span className="block max-w-[13rem] ml-auto text-right text-xs text-txt-tertiary">{parts.join(' · ') || '—'}</span>;
}

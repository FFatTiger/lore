'use client';

import React from 'react';
import { useT } from '../../lib/i18n';
import { PageCanvas, PageTitle, Section, Button, Badge, StatCard, Table, AppSelect } from '../../components/ui';
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
  onConfigChange: (field: keyof DreamConfig, value: boolean | number) => void;
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
  onConfigChange,
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

      <Section title={t('Schedule')} className="mb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-separator-thin bg-bg-raised px-3 py-2 text-sm text-txt-primary hover:border-separator hover:bg-bg-surface">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => onConfigChange('enabled', e.target.checked)}
              className="h-4 w-4 rounded border-separator-thin text-sys-blue accent-sys-blue"
            />
            <span>{t('Dream Diary')}</span>
          </label>
          <AppSelect
            value={String(config.schedule_hour)}
            onValueChange={(value) => onConfigChange('schedule_hour', Number(value))}
            options={Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: `${String(i).padStart(2, '0')}:00` }))}
            className="w-full sm:w-[9rem]"
          />
        </div>
      </Section>

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
    handleConfigChange,
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
      onConfigChange={(field, value) => void handleConfigChange(field, value)}
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
  if (agent?.tool_calls != null) parts.push(`${agent.tool_calls} ${t('calls')}`);
  if (summary.paths?.recommendations_count) parts.push(`${t('Path recs')} ${summary.paths.recommendations_count}`);
  if (summary.structure?.moved) parts.push(`${t('Moved')} ${summary.structure.moved}`);
  if (summary.structure?.protected_blocks) parts.push(`${t('Protected')} ${summary.structure.protected_blocks}`);
  if (summary.structure?.policy_blocks) parts.push(`${t('Policy blocks')} ${summary.structure.policy_blocks}`);
  if (summary.structure?.policy_warnings) parts.push(`${t('Policy warnings')} ${summary.structure.policy_warnings}`);
  const h = summary.health;
  if (h) {
    const items: string[] = [];
    if (h.healthy) items.push(`${t('healthy')} ${h.healthy}`);
    if (h.dead) items.push(`${t('dead')} ${h.dead}`);
    if (h.noisy) items.push(`${t('noisy')} ${h.noisy}`);
    if (items.length) parts.push(items.join(' '));
  }
  return <span className="block max-w-[13rem] ml-auto text-right text-xs text-txt-tertiary">{parts.join(' · ') || '—'}</span>;
}

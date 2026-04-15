'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import DiffViewer from '../../components/DiffViewer';
import { PageCanvas, PageTitle, Section, Button, Badge, StatCard, Table, EmptyState, Notice, inputClass } from '../../components/ui';
import { useConfirm } from '../../components/ConfirmDialog';

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

type StatusTone = 'green' | 'red' | 'default' | 'blue';

function statusTone(s: string): StatusTone {
  if (s === 'completed') return 'green';
  if (s === 'error') return 'red';
  if (s === 'rolled_back') return 'default';
  return 'blue';
}

interface ToolCall {
  tool: string;
  args?: unknown;
}

interface MemoryChangeBefore {
  content?: string;
  priority?: number;
  disclosure?: string;
}

interface MemoryChangeAfter {
  content?: string;
  priority?: number;
  disclosure?: string;
}

interface MemoryChange {
  type: string;
  uri: string;
  before?: MemoryChangeBefore;
  after?: MemoryChangeAfter;
}

interface DreamSummary {
  agent?: {
    tool_calls?: number;
  };
  health?: Record<string, number>;
  dead_writes?: {
    total?: number;
  };
  orphans?: {
    count?: number;
  };
}

interface DreamEntry {
  id: string | number;
  status: string;
  started_at?: string;
  duration_ms?: number;
  summary?: DreamSummary;
  narrative?: string;
  tool_calls?: ToolCall[];
  memory_changes?: MemoryChange[];
  error?: string;
}

interface DreamConfig {
  enabled: boolean;
  schedule_hour: number;
}

// ─── Main Component ──────────────────────────────────────────────────

export default function DreamPage(): React.JSX.Element {
  const { t } = useT();
  const { confirm: confirmDialog } = useConfirm();
  const [entries, setEntries] = useState<DreamEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [config, setConfig] = useState<DreamConfig>({ enabled: true, schedule_hour: 3 });
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [detail, setDetail] = useState<DreamEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadDiary = useCallback(async () => {
    try {
      const data = await api.get('/browse/dream', { params: { limit: 20, offset: 0 } }).then((r) => r.data);
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load dream diary', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.get('/browse/dream', { params: { action: 'config' } }).then((r) => r.data);
      setConfig(data);
    } catch {}
  }, []);

  useEffect(() => { loadDiary(); loadConfig(); }, [loadDiary, loadConfig]);

  const handleRun = async () => {
    setRunning(true);
    try {
      await api.post('/browse/dream', { action: 'run' }).then((r) => r.data);
      await loadDiary();
    } catch (err) {
      console.error('Dream failed', err);
    } finally {
      setRunning(false);
    }
  };

  const handleConfigChange = async (field: keyof DreamConfig, value: boolean | number) => {
    try {
      const updated = await api.post('/browse/dream', { action: 'config', [field]: value }).then((r) => r.data);
      setConfig(updated);
    } catch {}
  };

  const handleSelect = async (row: Record<string, unknown>) => {
    setSelectedId(row.id as string | number);
    setDetail(null);
    setDetailLoading(true);
    try {
      const entry = await api.get('/browse/dream', { params: { action: 'entry', id: row.id } }).then((r) => r.data);
      setDetail(entry);
    } catch {} finally {
      setDetailLoading(false);
    }
  };

  const handleBack = () => { setSelectedId(null); setDetail(null); };

  const handleRollback = async (id: string | number) => {
    const ok = await confirmDialog({ message: t('Confirm rollback? This will reverse all changes from this dream.'), destructive: true, confirmLabel: t('Rollback') });
    if (!ok) return;
    setRollingBack(true);
    try {
      await api.post('/browse/dream', { action: 'rollback', id }).then((r) => r.data);
      await loadDiary();
      handleBack();
    } catch (err) {
      console.error('Rollback failed', err);
    } finally {
      setRollingBack(false);
    }
  };

  const latestRollbackId = entries.find((e) => e.status === 'completed' || e.status === 'error')?.id || null;

  // ─── Detail View ─────────────────────────────────

  if (selectedId) {
    return (
      <PageCanvas size="5xl">
        <DetailView
          entry={detail}
          loading={detailLoading}
          canRollback={selectedId === latestRollbackId}
          rollingBack={rollingBack}
          onBack={handleBack}
          onRollback={() => handleRollback(selectedId)}
          t={t}
        />
      </PageCanvas>
    );
  }

  // ─── List View ───────────────────────────────────

  const lastEntry = entries[0];

  const columns = [
    { key: 'started_at', label: t('Date'), render: (v: unknown) => <span className="whitespace-nowrap">{fmtDate(String(v || ''))}</span> },
    { key: 'status', label: t('Status'), render: (v: unknown) => <Badge tone={statusTone(String(v || ''))}>{t(String(v || ''))}</Badge> },
    { key: 'duration_ms', label: t('Duration'), className: 'hidden sm:table-cell', render: (v: unknown) => fmtDuration(v as number) },
    { key: 'summary', label: t('Summary'), className: 'hidden sm:table-cell', render: (_: unknown, row: Record<string, unknown>) => <SummaryBadges summary={row.summary as DreamSummary} t={t} /> },
  ];

  return (
    <PageCanvas size="5xl">
      <PageTitle
        eyebrow={t('Memory Maintenance')}
        title={t('Dream Diary')}
        titleText={t('Dream Diary')}
        truncateTitle
        description={t('System dreams daily to organize memories — index refresh, health checks, and LLM-driven consolidation.')}
        right={
          <Button variant="primary" onClick={handleRun} disabled={running}>
            {running ? t('Dreaming…') : t('Run Dream Now')}
          </Button>
        }
      />

      {/* Stats */}
      <div className="animate-in stagger-1 mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={t('Last Dream')} value={lastEntry ? fmtDate(lastEntry.started_at) : '—'} tone="blue" compact />
        <StatCard label={t('Total Entries')} value={total} tone="default" compact />
        <StatCard label={t('Last Status')} value={lastEntry ? t(lastEntry.status) : '—'} tone={lastEntry ? statusTone(lastEntry.status) : 'default'} compact />
        <StatCard
          label={t('Schedule')}
          value={config.enabled ? `${String(config.schedule_hour).padStart(2, '0')}:00` : t('Off')}
          tone={config.enabled ? 'green' : 'default'}
          compact
        />
      </div>

      {/* Schedule config */}
      <Section title={t('Schedule')} className="mb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-separator-thin bg-bg-raised px-3 py-2 text-sm text-txt-primary hover:border-separator hover:bg-bg-surface">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => handleConfigChange('enabled', e.target.checked)}
              className="h-4 w-4 rounded border-separator-thin text-sys-blue accent-sys-blue"
            />
            <span>{t('Dream Diary')}</span>
          </label>
          <select
            value={config.schedule_hour}
            onChange={(e) => handleConfigChange('schedule_hour', Number(e.target.value))}
            className={inputClass + ' w-full sm:w-[9rem]'}
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
            ))}
          </select>
        </div>
      </Section>

      {/* Diary list */}
      <Section title={t('Dream Diary')} subtitle={`${total}`} className="mt-5">
        {loading ? (
          <div className="text-center py-8 text-txt-tertiary">{t('Loading…')}</div>
        ) : (
          <Table
            columns={columns}
            rows={entries as unknown as Record<string, unknown>[]}
            empty={t('No diary entries yet. Run your first dream!')}
            onRowClick={handleSelect}
          />
        )}
      </Section>
    </PageCanvas>
  );
}

// ─── Detail View ────────────────────────────────────────────────────

interface DetailViewProps {
  entry: DreamEntry | null;
  loading: boolean;
  canRollback: boolean;
  rollingBack: boolean;
  onBack: () => void;
  onRollback: () => void;
  t: (key: string) => string;
}

function DetailView({ entry, loading, canRollback, rollingBack, onBack, onRollback, t }: DetailViewProps): React.JSX.Element {
  if (loading || !entry) {
    return (
      <>
        <div className="mb-6">
          <Button variant="ghost" onClick={onBack}>← {t('Dream Diary')}</Button>
        </div>
        <div className="text-center py-12 text-txt-tertiary">{loading ? t('Loading…') : t('Not found')}</div>
      </>
    );
  }

  const stats = useMemo(() => {
    const tc = entry.tool_calls || [];
    return {
      viewed: tc.filter((c) => c.tool === 'get_node').length,
      modified: tc.filter((c) => c.tool === 'update_node').length,
      created: tc.filter((c) => c.tool === 'create_node').length,
      deleted: tc.filter((c) => c.tool === 'delete_node').length,
    };
  }, [entry]);

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <Button variant="ghost" onClick={onBack}>← {t('Dream Diary')}</Button>
        <div className="flex items-center gap-3 flex-wrap">
          <Badge tone={statusTone(entry.status)}>{t(entry.status)}</Badge>
          <span className="text-sm text-txt-tertiary">{fmtDate(entry.started_at)} · {fmtDuration(entry.duration_ms)}</span>
          {canRollback && (
            <Button variant="destructive" size="sm" onClick={onRollback} disabled={rollingBack}>
              {rollingBack ? t('Rolling back…') : t('Rollback')}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="animate-in stagger-1 mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={t('Viewed')} value={stats.viewed} tone="blue" compact />
        <StatCard label={t('Modified')} value={stats.modified} tone="orange" compact />
        <StatCard label={t('Created')} value={stats.created} tone="green" compact />
        <StatCard label={t('Deleted')} value={stats.deleted} tone="red" compact />
      </div>

      {/* Narrative */}
      {entry.narrative && (
        <Section title={t('Narrative')} className="mb-5">
          <div className="prose max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.narrative}</ReactMarkdown>
          </div>
        </Section>
      )}

      {/* Memory changes diff */}
      {entry.memory_changes && entry.memory_changes.length > 0 && (
        <MemoryChangesSection changes={entry.memory_changes} t={t} />
      )}

      {/* Tool calls (collapsed by default) */}
      {entry.tool_calls && entry.tool_calls.length > 0 && (
        <ToolCallsSection toolCalls={entry.tool_calls} t={t} />
      )}

      {/* Health report */}
      {entry.summary?.health && (
        <Section title={t('Health Report')} className="mt-5">
          <div className="flex gap-2 flex-wrap">
            {Object.entries(entry.summary.health).map(([k, v]) => (
              <Badge key={k} tone={k === 'healthy' ? 'green' : k === 'dead' ? 'red' : k === 'noisy' ? 'orange' : 'yellow'}>
                {t(k)} {v}
              </Badge>
            ))}
            {entry.summary?.dead_writes && <Badge tone="red">{t('dead writes')} {entry.summary.dead_writes.total}</Badge>}
            {entry.summary?.orphans && <Badge tone="default">{t('Orphans')} {entry.summary.orphans.count}</Badge>}
          </div>
        </Section>
      )}

      {/* Error */}
      {entry.error && (
        <Notice tone="danger" icon={<span aria-hidden>⚠️</span>} className="mt-5">
          <span className="font-mono">{entry.error}</span>
        </Notice>
      )}
    </>
  );
}

// ─── Tool Calls (collapsible) ───────────────────────────────────────

interface ToolCallsSectionProps {
  toolCalls: ToolCall[];
  t: (key: string) => string;
}

function ToolCallsSection({ toolCalls, t }: ToolCallsSectionProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <Section
      title={t('Tool Calls')}
      subtitle={`${toolCalls.length}`}
      right={
        <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▲' : '▼'}
        </Button>
      }
      className="mt-5"
    >
      {expanded && (
        <div className="space-y-1 max-h-[300px] sm:max-h-[500px] overflow-y-auto">
          {toolCalls.map((tc, i) => (
            <div key={i} className="flex items-start gap-2 text-xs font-mono rounded-lg px-3 py-2 bg-[var(--bg-primary)] border border-[var(--separator-thin)]">
              <Badge tone="blue">{tc.tool}</Badge>
              <span className="text-txt-secondary truncate flex-1">{JSON.stringify(tc.args).slice(0, 150)}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ─── Memory Changes (diff view) ─────────────────────────────────────

type ChangeTone = 'green' | 'red' | 'orange' | 'blue';

function changeTone(type: string): ChangeTone {
  if (type === 'create') return 'green';
  if (type === 'delete') return 'red';
  if (type === 'update') return 'orange';
  return 'blue';
}

interface MemoryChangesSectionProps {
  changes: MemoryChange[];
  t: (key: string) => string;
}

function MemoryChangesSection({ changes, t }: MemoryChangesSectionProps): React.JSX.Element {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <Section
      title={t('Memory Changes')}
      subtitle={`${changes.length}`}
      className="mb-5"
    >
      <div className="space-y-2">
        {changes.map((ch, i) => (
          <div key={i} className="rounded-xl border border-[var(--separator-thin)] bg-[var(--bg-primary)] overflow-hidden">
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--fill-quaternary)] transition-colors"
              onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
            >
              <Badge tone={changeTone(ch.type)}>{t(ch.type)}</Badge>
              <code className="text-xs font-mono text-txt-primary flex-1 truncate">{ch.uri}</code>
              {ch.before?.priority !== undefined && ch.after?.priority !== undefined && ch.before.priority !== ch.after.priority && (
                <span className="text-xs text-txt-tertiary">P{ch.before.priority}→P{ch.after.priority}</span>
              )}
              <span className="text-[11px] text-txt-quaternary">{expandedIdx === i ? '▲' : '▼'}</span>
            </div>
            {expandedIdx === i && (
              <div className="border-t border-[var(--separator-thin)] px-3 py-3 space-y-2">
                {ch.type === 'update' && ch.before?.content !== undefined && ch.after?.content !== undefined ? (
                  <DiffViewer oldText={ch.before.content} newText={ch.after.content} />
                ) : ch.type === 'create' && ch.after?.content ? (
                  <div>
                    <div className="text-[11px] font-medium text-txt-tertiary mb-1">{t('After')}</div>
                    <pre className="text-xs font-mono text-txt-secondary whitespace-pre-wrap max-h-48 overflow-y-auto">{ch.after.content}</pre>
                  </div>
                ) : ch.type === 'delete' && ch.before?.content ? (
                  <div>
                    <div className="text-[11px] font-medium text-txt-tertiary mb-1">{t('Before')}</div>
                    <pre className="text-xs font-mono text-txt-secondary whitespace-pre-wrap max-h-48 overflow-y-auto line-through opacity-60">{ch.before.content}</pre>
                  </div>
                ) : (
                  <div className="text-xs text-txt-tertiary">
                    {ch.before && <div>{t('Before')}: {JSON.stringify(ch.before)}</div>}
                    {ch.after && <div>{t('After')}: {JSON.stringify(ch.after)}</div>}
                  </div>
                )}
                {/* Disclosure / priority changes for non-content diffs */}
                {ch.type === 'update' && (ch.before?.disclosure !== ch.after?.disclosure) && (
                  <div className="text-xs text-txt-tertiary mt-1">
                    disclosure: <span className="line-through opacity-60">{ch.before?.disclosure || '(none)'}</span> → <span className="text-txt-primary">{ch.after?.disclosure || '(none)'}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── Summary badges for list view ───────────────────────────────────

interface SummaryBadgesProps {
  summary: DreamSummary | undefined | null;
  t: (key: string) => string;
}

function SummaryBadges({ summary, t }: SummaryBadgesProps): React.JSX.Element | string {
  if (!summary) return '—';
  const parts: string[] = [];
  const agent = summary.agent;
  if (agent?.tool_calls != null) parts.push(`${agent.tool_calls} ${t('calls')}`);
  const h = summary.health;
  if (h) {
    const items: string[] = [];
    if (h.healthy) items.push(`${t('healthy')} ${h.healthy}`);
    if (h.dead) items.push(`${t('dead')} ${h.dead}`);
    if (h.noisy) items.push(`${t('noisy')} ${h.noisy}`);
    if (items.length) parts.push(items.join(' '));
  }
  return <span className="text-xs text-txt-tertiary">{parts.join(' · ') || '—'}</span>;
}

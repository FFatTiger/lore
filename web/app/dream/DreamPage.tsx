'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import DiffViewer from '../../components/DiffViewer';
import { PageCanvas, PageTitle, Section, Button, Badge, StatCard, Table, EmptyState, Notice, inputClass, AppSelect } from '../../components/ui';
import { buildUrlWithSearchParams, readStringParam } from '../../lib/url-state';
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

function mergeWorkflowEvents(existing: DreamWorkflowEvent[] | undefined, incoming: DreamWorkflowEvent[]): DreamWorkflowEvent[] {
  const byId = new Map<number, DreamWorkflowEvent>();
  for (const event of existing || []) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

function formatProtectedNodeBlockedDetail(payload: Record<string, unknown> | undefined): string {
  if (!payload) return '';
  const blockedUri = typeof payload.blocked_uri === 'string' ? payload.blocked_uri : '';
  const requestedOldUri = typeof payload.requested_old_uri === 'string' ? payload.requested_old_uri : '';
  const requestedNewUri = typeof payload.requested_new_uri === 'string' ? payload.requested_new_uri : '';
  const tool = typeof payload.tool === 'string' ? payload.tool : '';

  if (tool === 'update_node' && blockedUri) return `固定启动节点 ${blockedUri} 不允许更新`;
  if (tool === 'delete_node' && blockedUri) return `固定启动节点 ${blockedUri} 不允许删除`;
  if (tool === 'move_node' && blockedUri) {
    if (requestedNewUri && requestedNewUri === blockedUri) {
      return requestedOldUri
        ? `不能把 ${requestedOldUri} 移动到固定启动路径 ${blockedUri}`
        : `不能把其他节点移动到固定启动路径 ${blockedUri}`;
    }
    return `固定启动节点 ${blockedUri} 不允许移动`;
  }
  if (blockedUri) return `固定启动节点 ${blockedUri} 已拦截`;
  return '';
}

function pickWorkflowArgs(payload: Record<string, unknown> | undefined): string {
  if (!payload) return '';
  const preferredKeys = ['uri', 'old_uri', 'new_uri', 'requested_old_uri', 'requested_new_uri', 'blocked_uri', 'query', 'keyword', 'node_uuid', 'days', 'limit', 'priority'];
  const compact: Record<string, unknown> = {};
  for (const key of preferredKeys) {
    if (payload[key] !== undefined) compact[key] = payload[key];
  }
  if (payload.tool && Object.keys(compact).length === 0) {
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'tool' || key === 'turn' || key === 'ok' || key === 'result_preview') continue;
      compact[key] = value;
    }
  }
  const text = JSON.stringify(compact);
  return text && text !== '{}' ? text : '';
}

function buildWorkflowRows(workflowEvents: DreamWorkflowEvent[]): Array<{ key: string; label: string; tone: 'green' | 'red' | 'orange' | 'blue' | 'default'; detail: string; time: string | null; }> {
  const rows: Array<{ key: string; label: string; tone: 'green' | 'red' | 'orange' | 'blue' | 'default'; detail: string; time: string | null; }> = [];
  const pendingTools = new Map<string, DreamWorkflowEvent>();

  for (const event of workflowEvents) {
    if (event.event_type === 'tool_call_started') {
      const tool = String(event.payload?.tool || 'tool');
      const turn = String(event.payload?.turn || '');
      pendingTools.set(`${turn}:${tool}`, event);
      continue;
    }

    if (event.event_type === 'tool_call_finished') {
      const tool = String(event.payload?.tool || 'tool');
      const turn = String(event.payload?.turn || '');
      const key = `${turn}:${tool}`;
      const started = pendingTools.get(key);
      pendingTools.delete(key);
      rows.push({
        key: `${event.id}`,
        label: tool,
        tone: event.payload?.ok === false ? 'red' : 'blue',
        detail: pickWorkflowArgs((started?.payload as Record<string, unknown> | undefined) || event.payload),
        time: event.created_at || started?.created_at || null,
      });
      continue;
    }

    if (event.event_type === 'tool_call_started') continue;
    if (event.event_type === 'llm_turn_started') continue;

    if (event.event_type === 'phase_started' || event.event_type === 'phase_completed') {
      rows.push({
        key: `${event.id}`,
        label: String(event.payload?.label || workflowEventLabel(event.event_type)),
        tone: workflowEventTone(event.event_type),
        detail: '',
        time: event.created_at || null,
      });
      continue;
    }

    rows.push({
      key: `${event.id}`,
      label: workflowEventLabel(event.event_type),
      tone: workflowEventTone(event.event_type),
      detail: event.event_type === 'assistant_note'
        ? String(event.payload?.message || '')
        : event.event_type === 'protected_node_blocked'
          ? formatProtectedNodeBlockedDetail(event.payload)
          : '',
      time: event.created_at || null,
    });
  }

  for (const event of pendingTools.values()) {
    rows.push({
      key: `pending-${event.id}`,
      label: String(event.payload?.tool || 'tool'),
      tone: 'blue',
      detail: pickWorkflowArgs(event.payload),
      time: event.created_at || null,
    });
  }

  return rows;
}

function workflowEventLabel(eventType: string): string {
  switch (eventType) {
    case 'run_started': return 'Run started';
    case 'phase_started': return 'Phase started';
    case 'phase_completed': return 'Phase completed';
    case 'llm_turn_started': return 'LLM turn';
    case 'tool_call_started': return 'Tool started';
    case 'tool_call_finished': return 'Tool finished';
    case 'protected_node_blocked': return 'Protected boot block';
    case 'assistant_note': return 'Assistant note';
    case 'run_completed': return 'Run completed';
    case 'run_failed': return 'Run failed';
    default: return eventType.replace(/_/g, ' ');
  }
}

function workflowEventTone(eventType: string): 'green' | 'red' | 'orange' | 'blue' | 'default' {
  if (eventType === 'run_completed') return 'green';
  if (eventType === 'run_failed') return 'red';
  if (eventType === 'protected_node_blocked' || eventType === 'assistant_note') return 'orange';
  if (eventType === 'phase_completed' || eventType === 'tool_call_finished') return 'green';
  return 'blue';
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

interface ToolCall {
  tool: string;
  args?: unknown;
}

interface DreamWorkflowEvent {
  id: number;
  diary_id: number;
  event_type: string;
  payload?: Record<string, unknown>;
  created_at?: string | null;
}

interface MemoryChangeBefore {
  content?: string;
  priority?: number;
  disclosure?: string;
  uri?: string;
}

interface MemoryChangeAfter {
  content?: string;
  priority?: number;
  disclosure?: string;
  uri?: string;
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
  paths?: {
    recommendations_count?: number;
  };
  structure?: {
    moved?: number;
    protected_blocks?: number;
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
  workflow_events?: DreamWorkflowEvent[];
  memory_changes?: MemoryChange[];
  error?: string;
}

interface DreamConfig {
  enabled: boolean;
  schedule_hour: number;
}

interface DreamDiaryListResponse {
  entries?: DreamEntry[];
  total?: number;
}

// ─── Main Component ──────────────────────────────────────────────────

export default function DreamPage(): React.JSX.Element {
  const { t } = useT();
  const { confirm: confirmDialog } = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = readStringParam(searchParams, 'entry');
  const [entries, setEntries] = useState<DreamEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [config, setConfig] = useState<DreamConfig>({ enabled: true, schedule_hour: 3 });
  const [detail, setDetail] = useState<DreamEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadEntry = useCallback(async (id: string | number): Promise<DreamEntry> => {
    return api.get('/browse/dream', { params: { action: 'entry', id } }).then((r) => r.data);
  }, []);

  const fetchDiaryPage = useCallback(async (): Promise<DreamDiaryListResponse> => {
    return api.get('/browse/dream', { params: { limit: 20, offset: 0 } }).then((r) => r.data as DreamDiaryListResponse);
  }, []);

  const applyDiaryPage = useCallback((data: DreamDiaryListResponse) => {
    setEntries(data.entries || []);
    setTotal(data.total || 0);
  }, []);

  const loadDiary = useCallback(async () => {
    try {
      const data = await fetchDiaryPage();
      applyDiaryPage(data);
      return data;
    } catch (err) {
      console.error('Failed to load dream diary', err);
      return { entries: [], total: 0 } satisfies DreamDiaryListResponse;
    } finally {
      setLoading(false);
    }
  }, [applyDiaryPage, fetchDiaryPage]);

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.get('/browse/dream', { params: { action: 'config' } }).then((r) => r.data);
      setConfig(data);
    } catch {}
  }, []);

  const navigateToDiary = useCallback((mode: 'push' | 'replace' = 'push') => {
    const href = buildUrlWithSearchParams('/dream', searchParams, { entry: '' }, { entry: '' });
    if (mode === 'replace') router.replace(href);
    else router.push(href);
  }, [router, searchParams]);

  const navigateToEntry = useCallback((id: string | number, mode: 'push' | 'replace' = 'push') => {
    const href = buildUrlWithSearchParams('/dream', searchParams, { entry: id }, { entry: '' });
    if (mode === 'replace') router.replace(href);
    else router.push(href);
  }, [router, searchParams]);

  useEffect(() => { loadDiary(); loadConfig(); }, [loadDiary, loadConfig]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    loadEntry(selectedId)
      .then((entry) => {
        if (!cancelled) setDetail(entry);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadEntry, selectedId]);

  const waitForNewRunningEntry = useCallback(async (knownIds: Set<string>): Promise<DreamEntry | null> => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const data = await fetchDiaryPage();
        applyDiaryPage(data);
        const nextRunningEntry = (data.entries || []).find((entry) => entry.status === 'running' && !knownIds.has(String(entry.id)));
        if (nextRunningEntry) return nextRunningEntry;
      } catch {}
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return null;
  }, [applyDiaryPage, fetchDiaryPage]);

  const handleRun = async () => {
    const knownIds = new Set(entries.map((entry) => String(entry.id)));
    setRunning(true);
    try {
      const runRequest = api.post('/browse/dream', { action: 'run' }).then((r) => r.data as DreamEntry);
      let openedEntryId: string | number | null = null;
      const nextRunningEntry = await waitForNewRunningEntry(knownIds);
      if (nextRunningEntry) {
        openedEntryId = nextRunningEntry.id;
        navigateToEntry(nextRunningEntry.id);
      }
      const result = await runRequest;
      if (openedEntryId == null && result?.id != null) {
        navigateToEntry(result.id);
      }
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

  const handleSelect = (row: Record<string, unknown>) => {
    const id = String(row.id || '').trim();
    if (!id) return;
    navigateToEntry(id);
  };

  const handleBack = () => { navigateToDiary('replace'); };

  const handleRollback = async (id: string | number) => {
    const ok = await confirmDialog({ message: t('Confirm rollback? This will reverse all changes from this dream.'), destructive: true, confirmLabel: t('Rollback') });
    if (!ok) return;
    setRollingBack(true);
    try {
      await api.post('/browse/dream', { action: 'rollback', id }).then((r) => r.data);
      await loadDiary();
      navigateToDiary('replace');
    } catch (err) {
      console.error('Rollback failed', err);
    } finally {
      setRollingBack(false);
    }
  };

  const latestRollbackId = String(entries.find((e) => e.status === 'completed' || e.status === 'error')?.id || '');

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
          onRefreshEntry={loadEntry}
          onEntryChange={setDetail}
          t={t}
        />
      </PageCanvas>
    );
  }

  // ─── List View ───────────────────────────────────

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
          <Button variant="primary" onClick={handleRun} disabled={running}>
            {running ? t('Dreaming…') : t('Run Dream Now')}
          </Button>
        }
      />

      {/* Stats */}
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
          <AppSelect
            value={String(config.schedule_hour)}
            onValueChange={(value) => handleConfigChange('schedule_hour', Number(value))}
            options={Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: `${String(i).padStart(2, '0')}:00` }))}
            className="w-full sm:w-[9rem]"
          />
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
            activeRowKey={selectedId}
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
  onRefreshEntry: (id: string | number) => Promise<DreamEntry>;
  onEntryChange: React.Dispatch<React.SetStateAction<DreamEntry | null>>;
  t: (key: string) => string;
}

function DetailView({ entry, loading, canRollback, rollingBack, onBack, onRollback, onRefreshEntry, onEntryChange, t }: DetailViewProps): React.JSX.Element {
  useEffect(() => {
    if (!entry || entry.status !== 'running') return;

    let closed = false;
    let source: EventSource | null = null;
    const lastEventId = entry.workflow_events?.at(-1)?.id || 0;
    const params = new URLSearchParams({
      action: 'workflow_stream',
      id: String(entry.id),
    });
    if (lastEventId > 0) params.set('since_id', String(lastEventId));
    source = new EventSource(`/api/browse/dream?${params.toString()}`);

    const handleWorkflowEvent = (ev: MessageEvent<string>) => {
      if (closed) return;
      try {
        const workflowEvent = JSON.parse(ev.data) as DreamWorkflowEvent;
        onEntryChange((prev) => {
          if (!prev || String(prev.id) !== String(entry.id)) return prev;
          return {
            ...prev,
            workflow_events: mergeWorkflowEvents(prev.workflow_events, [workflowEvent]),
          };
        });
      } catch {}
    };

    const handleDone = async () => {
      if (closed) return;
      source?.close();
      source = null;
      try {
        const refreshed = await onRefreshEntry(entry.id);
        if (!closed) onEntryChange(refreshed);
      } catch {}
    };

    const handleError = () => {
      source?.close();
      source = null;
    };

    source.addEventListener('workflow_event', handleWorkflowEvent as EventListener);
    source.addEventListener('done', handleDone as EventListener);
    source.addEventListener('error', handleError as EventListener);
    source.onerror = handleError;

    return () => {
      closed = true;
      source?.close();
    };
  }, [entry, onEntryChange, onRefreshEntry]);

  const stats = useMemo(() => {
    const tc = entry?.tool_calls || [];
    const changes = entry?.memory_changes || [];
    return {
      viewed: tc.filter((c) => c.tool === 'get_node').length,
      modified: tc.filter((c) => c.tool === 'update_node').length,
      created: tc.filter((c) => c.tool === 'create_node').length,
      deleted: tc.filter((c) => c.tool === 'delete_node').length,
      moved: changes.filter((c) => c.type === 'move').length,
      protectedBlocks: (entry?.workflow_events || []).filter((e) => e.event_type === 'protected_node_blocked').length,
    };
  }, [entry]);

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

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <Button variant="ghost" onClick={onBack}>← {t('Dream Diary')}</Button>
        <div className="flex items-center gap-3 flex-wrap">
          <Badge className="min-w-[3.9rem] justify-center" tone={statusTone(entry.status)}>{t(entry.status)}</Badge>
          <span className="text-sm text-txt-tertiary">{fmtDate(entry.started_at)} · {fmtDuration(entry.duration_ms)}</span>
          {canRollback && (
            <Button variant="destructive" size="sm" onClick={onRollback} disabled={rollingBack}>
              {rollingBack ? t('Rolling back…') : t('Rollback')}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="animate-in stagger-1 mb-5 grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label={t('Viewed')} value={stats.viewed} tone="blue" compact />
        <StatCard label={t('Modified')} value={stats.modified} tone="orange" compact />
        <StatCard label={t('Created')} value={stats.created} tone="green" compact />
        <StatCard label={t('Deleted')} value={stats.deleted} tone="red" compact />
        <StatCard label={t('Moved')} value={stats.moved} tone="blue" compact />
        <StatCard label={t('Protected')} value={stats.protectedBlocks} tone="orange" compact />
      </div>

      {/* Narrative */}
      {entry.narrative && (
        <Section title={t('Narrative')} className="mb-5">
          <div className="prose max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.narrative}</ReactMarkdown>
          </div>
        </Section>
      )}

      {/* Workflow */}
      {(entry.status === 'running' || (entry.workflow_events && entry.workflow_events.length > 0)) && (
        <AgentWorkflowSection
          workflowEvents={entry.workflow_events || []}
          defaultExpanded={entry.status === 'running'}
          t={t}
        />
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
        <Notice tone="danger" className="mt-5">
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

interface AgentWorkflowSectionProps {
  workflowEvents: DreamWorkflowEvent[];
  defaultExpanded: boolean;
  t: (key: string) => string;
}

function AgentWorkflowSection({ workflowEvents, defaultExpanded, t }: AgentWorkflowSectionProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const rows = useMemo(() => buildWorkflowRows(workflowEvents), [workflowEvents]);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <Section
      title={t('Agent Workflow')}
      subtitle={`${rows.length}`}
      right={
        <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▲' : '▼'}
        </Button>
      }
      className="mb-5"
    >
      {expanded && (
        rows.length > 0 ? (
          <div className="space-y-2 max-h-[360px] sm:max-h-[560px] overflow-y-auto">
            {rows.map((row) => (
              <div key={row.key} className="flex items-start gap-2 rounded-xl border border-[var(--separator-thin)] bg-[var(--bg-primary)] px-3 py-3">
                <Badge tone={row.tone}>{t(row.label)}</Badge>
                <div className="min-w-0 flex-1">
                  {row.detail && <div className="truncate text-xs font-mono text-txt-secondary">{row.detail}</div>}
                </div>
                <span className="shrink-0 text-xs text-txt-tertiary">{fmtDate(row.time)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-txt-tertiary">{t('Waiting for workflow events…')}</div>
        )
      )}
    </Section>
  );
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
  if (type === 'move') return 'blue';
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
              {ch.type === 'move' && ch.before?.uri && ch.after?.uri && (
                <span className="text-xs text-txt-tertiary truncate max-w-[16rem]">{ch.before.uri} → {ch.after.uri}</span>
              )}
              <span className="text-[11px] text-txt-quaternary">{expandedIdx === i ? '▲' : '▼'}</span>
            </div>
            {expandedIdx === i && (
              <div className="border-t border-[var(--separator-thin)] px-3 py-3 space-y-2">
                {ch.type === 'update' && ch.before?.content !== undefined && ch.after?.content !== undefined ? (
                  <DiffViewer oldText={ch.before.content} newText={ch.after.content} />
                ) : ch.type === 'move' && ch.before?.uri && ch.after?.uri ? (
                  <div className="text-xs text-txt-tertiary space-y-1">
                    <div>{t('Before')}: <code className="font-mono text-txt-primary">{ch.before.uri}</code></div>
                    <div>{t('After')}: <code className="font-mono text-txt-primary">{ch.after.uri}</code></div>
                  </div>
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
  if (summary.paths?.recommendations_count) parts.push(`${t('Path recs')} ${summary.paths.recommendations_count}`);
  if (summary.structure?.moved) parts.push(`${t('Moved')} ${summary.structure.moved}`);
  if (summary.structure?.protected_blocks) parts.push(`${t('Protected')} ${summary.structure.protected_blocks}`);
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

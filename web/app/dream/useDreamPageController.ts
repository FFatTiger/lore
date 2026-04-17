'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { buildUrlWithSearchParams, readStringParam } from '../../lib/url-state';

export interface ToolCall {
  tool: string;
  args?: unknown;
}

export interface DreamWorkflowEvent {
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

export interface MemoryChange {
  type: string;
  uri: string;
  before?: MemoryChangeBefore;
  after?: MemoryChangeAfter;
}

export interface DreamSummary {
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
    policy_blocks?: number;
    policy_warnings?: number;
  };
  orphans?: {
    count?: number;
  };
}

export interface DreamEntry {
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

export interface DreamConfig {
  enabled: boolean;
  schedule_hour: number;
}

interface DreamDiaryListResponse {
  entries?: DreamEntry[];
  total?: number;
}

interface ConfirmDialogOptions {
  message: string;
  destructive?: boolean;
  confirmLabel?: string;
}

type ConfirmDialog = (options: ConfirmDialogOptions) => Promise<boolean>;

type Translate = (key: string) => string;

function mergeWorkflowEvents(existing: DreamWorkflowEvent[] | undefined, incoming: DreamWorkflowEvent[]): DreamWorkflowEvent[] {
  const byId = new Map<number, DreamWorkflowEvent>();
  for (const event of existing || []) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

interface UseDreamPageControllerArgs {
  confirmDialog: ConfirmDialog;
  t: Translate;
}

interface UseDreamPageControllerResult {
  selectedId: string;
  entries: DreamEntry[];
  total: number;
  loading: boolean;
  running: boolean;
  rollingBack: boolean;
  config: DreamConfig;
  detail: DreamEntry | null;
  detailLoading: boolean;
  latestRollbackId: string;
  handleRun: () => Promise<void>;
  handleConfigChange: (field: keyof DreamConfig, value: boolean | number) => Promise<void>;
  handleSelect: (row: Record<string, unknown>) => void;
  handleBack: () => void;
  handleRollback: (id: string | number) => Promise<void>;
}

export function useDreamPageController({ confirmDialog, t }: UseDreamPageControllerArgs): UseDreamPageControllerResult {
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
    return api.get('/browse/dream', { params: { action: 'entry', id } }).then((response) => response.data as DreamEntry);
  }, []);

  const fetchDiaryPage = useCallback(async (): Promise<DreamDiaryListResponse> => {
    return api.get('/browse/dream', { params: { limit: 20, offset: 0 } }).then((response) => response.data as DreamDiaryListResponse);
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
    } catch (error) {
      console.error('Failed to load dream diary', error);
      return { entries: [], total: 0 } satisfies DreamDiaryListResponse;
    } finally {
      setLoading(false);
    }
  }, [applyDiaryPage, fetchDiaryPage]);

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.get('/browse/dream', { params: { action: 'config' } }).then((response) => response.data as DreamConfig);
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

  useEffect(() => {
    void loadDiary();
    void loadConfig();
  }, [loadConfig, loadDiary]);

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

  useEffect(() => {
    if (!detail || detail.status !== 'running') return;

    let closed = false;
    let source: EventSource | null = null;
    const lastEventId = detail.workflow_events?.at(-1)?.id || 0;
    const params = new URLSearchParams({
      action: 'workflow_stream',
      id: String(detail.id),
    });
    if (lastEventId > 0) params.set('since_id', String(lastEventId));
    source = new EventSource(`/api/browse/dream?${params.toString()}`);

    const handleWorkflowEvent = (event: MessageEvent<string>) => {
      if (closed) return;
      try {
        const workflowEvent = JSON.parse(event.data) as DreamWorkflowEvent;
        setDetail((previous) => {
          if (!previous || String(previous.id) !== String(detail.id)) return previous;
          return {
            ...previous,
            workflow_events: mergeWorkflowEvents(previous.workflow_events, [workflowEvent]),
          };
        });
      } catch {}
    };

    const handleDone = async () => {
      if (closed) return;
      source?.close();
      source = null;
      try {
        const refreshed = await loadEntry(detail.id);
        if (!closed) setDetail(refreshed);
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
  }, [detail, loadEntry]);

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

  const handleRun = useCallback(async () => {
    const knownIds = new Set(entries.map((entry) => String(entry.id)));
    setRunning(true);
    try {
      const runRequest = api.post('/browse/dream', { action: 'run' }).then((response) => response.data as DreamEntry);
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
    } catch (error) {
      console.error('Dream failed', error);
    } finally {
      setRunning(false);
    }
  }, [entries, loadDiary, navigateToEntry, waitForNewRunningEntry]);

  const handleConfigChange = useCallback(async (field: keyof DreamConfig, value: boolean | number) => {
    try {
      const updated = await api.post('/browse/dream', { action: 'config', [field]: value }).then((response) => response.data as DreamConfig);
      setConfig(updated);
    } catch {}
  }, []);

  const handleSelect = useCallback((row: Record<string, unknown>) => {
    const id = String(row.id || '').trim();
    if (!id) return;
    navigateToEntry(id);
  }, [navigateToEntry]);

  const handleBack = useCallback(() => {
    navigateToDiary('replace');
  }, [navigateToDiary]);

  const handleRollback = useCallback(async (id: string | number) => {
    const ok = await confirmDialog({
      message: t('Confirm rollback? This will reverse all changes from this dream.'),
      destructive: true,
      confirmLabel: t('Rollback'),
    });
    if (!ok) return;

    setRollingBack(true);
    try {
      await api.post('/browse/dream', { action: 'rollback', id }).then((response) => response.data);
      await loadDiary();
      navigateToDiary('replace');
    } catch (error) {
      console.error('Rollback failed', error);
    } finally {
      setRollingBack(false);
    }
  }, [confirmDialog, loadDiary, navigateToDiary, t]);

  const latestRollbackId = String(entries.find((entry) => entry.status === 'completed' || entry.status === 'error')?.id || '');

  return {
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
  };
}

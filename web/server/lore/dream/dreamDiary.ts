import { sql } from '../../db';
import { clampLimit } from '../core/utils';
import { getSettings as getSettingsBatch, updateSettings } from '../config/settings';
import { ensureRecallIndex } from '../recall/recall';
import { getMemoryHealthReport, getDeadWrites, getPathEffectiveness } from '../recall/feedbackAnalytics';
import { getRecallStats } from '../recall/recallAnalytics';
import { getWriteEventStats } from '../memory/writeEvents';
import { listOrphans } from '../ops/maintenance';
import { createNode, updateNodeByPath, deleteNodeByPath, moveNode } from '../memory/write';
import { addGlossaryKeyword, removeGlossaryKeyword } from '../search/glossary';
import {
  loadLlmConfig,
  runDreamAgentLoop,
  parseUri,
  DREAM_EVENT_CONTEXT,
  type HealthData,
  type ToolCallLogEntry,
} from './dreamAgent';
import { appendDreamWorkflowEvent, listDreamWorkflowEvents, type DreamWorkflowEvent } from './dreamWorkflow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiaryEntry {
  id: number;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  status: string;
  summary: Record<string, unknown>;
  narrative: string | null;
  error: string | null;
  tool_calls?: Array<Record<string, unknown>>;
  details?: Record<string, unknown>;
  workflow_events?: DreamWorkflowEvent[];
  memory_changes?: Array<{
    type: string;
    uri: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    at: string | null;
  }>;
}

interface DreamConfig {
  enabled: boolean;
  schedule_hour: number;
  timezone: string;
  last_run_date: string | null;
}

interface DreamResult {
  id: number;
  status: string;
  duration_ms: number;
  summary: Record<string, unknown>;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Main dream orchestration
// ---------------------------------------------------------------------------

let _dreamRunning = false;

export async function runDream(): Promise<DreamResult> {
  if (_dreamRunning) {
    const err = new Error('Dream is already running') as Error & { status: number };
    err.status = 409;
    throw err;
  }
  _dreamRunning = true;
  const startedAt = Date.now();

  // Insert diary row
  const insertResult = await sql(
    `INSERT INTO dream_diary (started_at, status) VALUES (NOW(), 'running') RETURNING id`,
  );
  const diaryId = Number(insertResult.rows[0].id);
  await appendDreamWorkflowEvent(diaryId, 'run_started', { diary_id: diaryId });

  try {
    // Step 1: Index refresh
    console.log('[dream] step 1: index refresh');
    await appendDreamWorkflowEvent(diaryId, 'phase_started', { phase: 'index_refresh', label: 'Index refresh' });
    const indexResult = await ensureRecallIndex();
    await appendDreamWorkflowEvent(diaryId, 'phase_completed', {
      phase: 'index_refresh',
      label: 'Index refresh',
      summary: indexResult as Record<string, unknown>,
    });

    // Step 2: Data collection
    console.log('[dream] step 2: data collection');
    await appendDreamWorkflowEvent(diaryId, 'phase_started', { phase: 'data_collection', label: 'Data collection' });
    const [health, deadWrites, pathEffectiveness, recallStats, writeStats] = await Promise.all([
      getMemoryHealthReport({ days: 7, limit: 50 }),
      getDeadWrites({ days: 30, limit: 50 }),
      getPathEffectiveness({ days: 7 }),
      getRecallStats({ days: 1, limit: 20 }),
      getWriteEventStats({ days: 1, limit: 20 }),
    ]);
    let orphanCount = 0;
    try { orphanCount = (await listOrphans()).length; } catch {}
    await appendDreamWorkflowEvent(diaryId, 'phase_completed', {
      phase: 'data_collection',
      label: 'Data collection',
      summary: {
        orphan_count: orphanCount,
        recall_queries: ((recallStats as Record<string, unknown>).summary as Record<string, unknown>)?.query_count || 0,
        write_events: ((writeStats as unknown as Record<string, unknown>).summary as Record<string, unknown>)?.total_events || 0,
      },
    });

    const healthData: HealthData = { health: health as unknown as Record<string, unknown>, deadWrites: deadWrites as unknown as Record<string, unknown>, pathEffectiveness: pathEffectiveness as unknown as Record<string, unknown>, recallStats: recallStats as unknown as Record<string, unknown>, writeStats: writeStats as unknown as Record<string, unknown>, orphanCount };

    // Fetch recent diaries so the agent knows what was already done
    const recentDiariesResult = await sql(
      `SELECT started_at, status, narrative, tool_calls FROM dream_diary
       WHERE status = 'completed' AND id != $1
       ORDER BY started_at DESC LIMIT 2`,
      [diaryId],
    );
    const recentDiaries = recentDiariesResult.rows.map((r: Record<string, unknown>) => ({
      started_at: r.started_at ? new Date(r.started_at as string).toISOString() : null,
      status: r.status as string,
      narrative: (r.narrative as string) || null,
      tool_calls: ((r.tool_calls as Array<{ tool: string; args: Record<string, unknown> }>) || []).slice(0, 20),
    }));

    // Step 3: LLM agent loop
    console.log('[dream] step 3: agent loop');
    await appendDreamWorkflowEvent(diaryId, 'phase_started', { phase: 'agent_loop', label: 'Agent loop' });
    const llmConfig = await loadLlmConfig();
    let agentResult: { narrative: string; toolCalls: ToolCallLogEntry[]; turns: number } = {
      narrative: '(LLM not configured — skipped agent loop)',
      toolCalls: [],
      turns: 0,
    };
    if (llmConfig) {
      agentResult = await runDreamAgentLoop(llmConfig, healthData, recentDiaries, {
        onEvent: async (eventType, payload) => {
          await appendDreamWorkflowEvent(diaryId, eventType, payload || {});
        },
        eventContext: {
          ...DREAM_EVENT_CONTEXT,
          session_id: `dream:${diaryId}`,
        },
      });
    } else {
      await appendDreamWorkflowEvent(diaryId, 'assistant_note', { message: 'LLM not configured — skipped agent loop' });
    }
    await appendDreamWorkflowEvent(diaryId, 'phase_completed', {
      phase: 'agent_loop',
      label: 'Agent loop',
      summary: { turns: agentResult.turns, tool_calls: agentResult.toolCalls.length },
    });

    const workflowEvents = await listDreamWorkflowEvents(diaryId);
    const memoryChangeStatsResult = await sql(
      `SELECT event_type, COUNT(*)::int AS total
       FROM memory_events
       WHERE source = 'dream:auto'
         AND created_at >= (SELECT started_at FROM dream_diary WHERE id = $1)
       GROUP BY event_type`,
      [diaryId],
    );
    const memoryChangeCounts = Object.fromEntries(
      memoryChangeStatsResult.rows.map((row: Record<string, unknown>) => [
        String(row.event_type || ''),
        Number(row.total || 0),
      ]),
    ) as Record<string, number>;
    const protectedBlocks = workflowEvents.filter((event) => event.event_type === 'protected_node_blocked').length;
    const policyBlocks = workflowEvents.filter((event) => event.event_type === 'policy_validation_blocked').length;
    const policyWarnings = workflowEvents.filter((event) => event.event_type === 'policy_warning_emitted').length;

    // Step 4: Save diary
    const indexResultTyped = indexResult as Record<string, unknown>;
    const summary: Record<string, unknown> = {
      index: { source_count: indexResultTyped.source_count, updated_count: indexResultTyped.updated_count, deleted_count: indexResultTyped.deleted_count },
      health: (health as unknown as Record<string, unknown>).classification_summary,
      dead_writes: { total: (deadWrites as unknown as Record<string, unknown>).total_dead_writes },
      paths: { recommendations_count: ((pathEffectiveness as unknown as Record<string, unknown>).recommendations as unknown[] || []).length },
      structure: {
        moved: Number(memoryChangeCounts.move || 0),
        protected_blocks: protectedBlocks,
        policy_blocks: policyBlocks,
        policy_warnings: policyWarnings,
      },
      activity: {
        recall_events: ((recallStats as unknown as Record<string, unknown>).summary as Record<string, unknown>)?.merged_count || 0,
        recall_queries: ((recallStats as unknown as Record<string, unknown>).summary as Record<string, unknown>)?.query_count || 0,
        write_events: ((writeStats as unknown as Record<string, unknown>).summary as Record<string, unknown>)?.total_events || 0,
      },
      orphans: { count: orphanCount },
      agent: { tool_calls: agentResult.toolCalls.length, turns: agentResult.turns },
    };

    const durationMs = Date.now() - startedAt;
    await sql(
      `UPDATE dream_diary SET status = 'completed', completed_at = NOW(), duration_ms = $2,
       summary = $3::jsonb, narrative = $4, tool_calls = $5::jsonb, details = $6::jsonb
       WHERE id = $1`,
      [diaryId, durationMs, JSON.stringify(summary), agentResult.narrative, JSON.stringify(agentResult.toolCalls), JSON.stringify({ index: indexResult, health, deadWrites, pathEffectiveness })],
    );
    await appendDreamWorkflowEvent(diaryId, 'run_completed', {
      duration_ms: durationMs,
      summary,
      tool_calls: agentResult.toolCalls.length,
      turns: agentResult.turns,
    });

    console.log(`[dream] completed in ${(durationMs / 1000).toFixed(1)}s, ${agentResult.toolCalls.length} tool calls`);
    return { id: diaryId, status: 'completed', duration_ms: durationMs, summary, narrative: agentResult.narrative };
  } catch (err: unknown) {
    const durationMs = Date.now() - startedAt;
    await sql(
      `UPDATE dream_diary SET status = 'error', completed_at = NOW(), duration_ms = $2, error = $3 WHERE id = $1`,
      [diaryId, durationMs, (err as Error).message],
    ).catch(() => {});
    await appendDreamWorkflowEvent(diaryId, 'run_failed', {
      duration_ms: durationMs,
      error: (err as Error).message,
    }).catch(() => {});
    console.error('[dream] failed', err);
    throw err;
  } finally {
    _dreamRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Diary CRUD
// ---------------------------------------------------------------------------

export async function getDreamDiary({ limit = 20, offset = 0 } = {}): Promise<{
  entries: DiaryEntry[];
  total: number;
  limit: number;
  offset: number;
}> {
  const safeLimit = clampLimit(limit, 1, 100, 20);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const [entries, count] = await Promise.all([
    sql(`SELECT id, started_at, completed_at, duration_ms, status, summary, narrative, error FROM dream_diary ORDER BY started_at DESC LIMIT $1 OFFSET $2`, [safeLimit, safeOffset]),
    sql(`SELECT COUNT(*)::int AS total FROM dream_diary`),
  ]);
  return {
    entries: entries.rows.map((row: Record<string, unknown>) => formatDiaryRow(row)),
    total: (count.rows[0]?.total as number) || 0,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function getDreamEntry(id: number | string): Promise<DiaryEntry | null> {
  const result = await sql(`SELECT * FROM dream_diary WHERE id = $1`, [Number(id)]);
  if (!result.rows[0]) return null;
  const entry = formatDiaryRow(result.rows[0] as Record<string, unknown>, true);
  entry.workflow_events = await listDreamWorkflowEvents(entry.id);

  // Fetch memory changes made during this dream
  if (entry.started_at) {
    const eventsResult = await sql(
      `SELECT event_type, node_uri, before_snapshot, after_snapshot, created_at
       FROM memory_events
       WHERE source = 'dream:auto'
         AND created_at >= $1
         AND ($2::timestamptz IS NULL OR created_at <= $2)
       ORDER BY created_at ASC`,
      [entry.started_at, entry.completed_at],
    );
    entry.memory_changes = eventsResult.rows.map((r: Record<string, unknown>) => ({
      type: r.event_type as string,
      uri: r.node_uri as string,
      before: (r.before_snapshot as Record<string, unknown>) || null,
      after: (r.after_snapshot as Record<string, unknown>) || null,
      at: r.created_at ? new Date(r.created_at as string).toISOString() : null,
    }));
  }

  return entry;
}

function formatDiaryRow(row: Record<string, unknown>, includeDetails = false): DiaryEntry {
  const entry: DiaryEntry = {
    id: Number(row.id),
    started_at: row.started_at ? new Date(row.started_at as string).toISOString() : null,
    completed_at: row.completed_at ? new Date(row.completed_at as string).toISOString() : null,
    duration_ms: (row.duration_ms as number) || null,
    status: row.status as string,
    summary: (row.summary as Record<string, unknown>) || {},
    narrative: (row.narrative as string) || null,
    error: (row.error as string) || null,
  };
  if (includeDetails) {
    entry.tool_calls = (row.tool_calls as Array<Record<string, unknown>>) || [];
    entry.details = (row.details as Record<string, unknown>) || {};
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

const ROLLBACK_EVENT_CONTEXT = { source: 'dream:rollback' };

export async function rollbackDream(id: number | string): Promise<{
  id: number;
  status: string;
  events_total: number;
  events_reversed: number;
}> {
  const numId = Number(id);

  // 1. Verify this is the latest diary entry and is rollbackable
  const latestResult = await sql(`SELECT id, status, started_at, completed_at FROM dream_diary ORDER BY started_at DESC LIMIT 1`);
  const latest = latestResult.rows[0] as Record<string, unknown> | undefined;
  if (!latest || Number(latest.id) !== numId) {
    const err = new Error('Only the most recent dream can be rolled back') as Error & { status: number };
    err.status = 409;
    throw err;
  }
  if (latest.status !== 'completed' && latest.status !== 'error') {
    const err = new Error(`Cannot rollback dream with status '${latest.status}'`) as Error & { status: number };
    err.status = 409;
    throw err;
  }

  // 2. Fetch all dream:auto events from this dream session (LIFO order)
  const eventsResult = await sql(
    `SELECT id, event_type, node_uri, node_uuid, domain, path, before_snapshot, after_snapshot, details
     FROM memory_events
     WHERE source = 'dream:auto'
       AND created_at >= $1
       AND ($2::timestamptz IS NULL OR created_at <= $2)
     ORDER BY id DESC`,
    [latest.started_at, latest.completed_at],
  );

  const events = eventsResult.rows as Array<Record<string, unknown>>;
  console.log(`[dream:rollback] rolling back ${events.length} events for dream #${numId}`);

  let rolled = 0;
  for (const evt of events) {
    try {
      const before = (evt.before_snapshot as Record<string, unknown>) || {};
      const after = (evt.after_snapshot as Record<string, unknown>) || {};
      const domain = (evt.domain as string) || 'core';
      const evtPath = (evt.path as string) || '';

      switch (evt.event_type) {
        case 'create':
          // Reverse: delete the created node
          if (domain && evtPath) await deleteNodeByPath({ domain, path: evtPath }, ROLLBACK_EVENT_CONTEXT);
          break;
        case 'update':
          // Reverse: restore before_snapshot
          if (domain && evtPath) {
            await updateNodeByPath({
              domain, path: evtPath,
              content: before.content as string | undefined,
              priority: before.priority as number | undefined,
              disclosure: before.disclosure as string | undefined,
            }, ROLLBACK_EVENT_CONTEXT);
          }
          break;
        case 'delete':
          // Reverse: recreate with before_snapshot
          if (before.content !== undefined && domain && evtPath) {
            const segments = evtPath.split('/').filter(Boolean);
            const title = segments.pop() || '';
            const parentPath = segments.join('/');
            await createNode({
              domain, parentPath, content: before.content as string,
              priority: (before.priority as number) ?? 2, title,
              disclosure: (before.disclosure as string) || null,
            }, ROLLBACK_EVENT_CONTEXT);
          }
          break;
        case 'move':
          if (before.uri && after.uri) {
            await moveNode({
              old_uri: after.uri as string,
              new_uri: before.uri as string,
            }, ROLLBACK_EVENT_CONTEXT);
          }
          break;
        case 'alias':
          // Reverse: delete the alias path
          if (after.new_uri) {
            const parsed = parseUri(after.new_uri as string);
            await deleteNodeByPath({ domain: parsed.domain, path: parsed.path }, ROLLBACK_EVENT_CONTEXT);
          }
          break;
        case 'glossary_add':
          // Reverse: remove the keyword
          if (after.keyword && evt.node_uuid) {
            await removeGlossaryKeyword({ keyword: after.keyword as string, node_uuid: evt.node_uuid as string }, ROLLBACK_EVENT_CONTEXT);
          }
          break;
        case 'glossary_remove':
          // Reverse: add the keyword back
          if (before.keyword && evt.node_uuid) {
            await addGlossaryKeyword({ keyword: before.keyword as string, node_uuid: evt.node_uuid as string }, ROLLBACK_EVENT_CONTEXT);
          }
          break;
        default:
          console.log(`[dream:rollback] skipping unknown event_type: ${evt.event_type}`);
      }
      rolled++;
    } catch (err: unknown) {
      console.error(`[dream:rollback] failed to reverse event #${evt.id} (${evt.event_type} ${evt.node_uri}):`, (err as Error).message);
    }
  }

  // 3. Mark diary as rolled back
  await sql(`UPDATE dream_diary SET status = 'rolled_back' WHERE id = $1`, [numId]);

  console.log(`[dream:rollback] done: ${rolled}/${events.length} events reversed`);
  return { id: numId, status: 'rolled_back', events_total: events.length, events_reversed: rolled };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getDreamConfig(): Promise<DreamConfig> {
  const s = await getSettingsBatch(['dream.enabled', 'dream.schedule_hour', 'dream.timezone']);
  let lastRunDate: string | null = null;
  try {
    const r = await sql(`SELECT value FROM app_settings WHERE key = 'dream.last_run_date'`);
    lastRunDate = (r.rows[0]?.value as Record<string, unknown>)?.value as string || null;
  } catch {}
  return {
    enabled: s['dream.enabled'] !== false,
    schedule_hour: Number(s['dream.schedule_hour'] ?? 3),
    timezone: String(s['dream.timezone'] || 'Asia/Shanghai'),
    last_run_date: lastRunDate,
  };
}

export async function updateDreamConfig({ enabled, schedule_hour, timezone }: {
  enabled?: boolean;
  schedule_hour?: number;
  timezone?: string;
} = {}): Promise<DreamConfig> {
  const patch: Record<string, unknown> = {};
  if (enabled !== undefined) patch['dream.enabled'] = enabled;
  if (schedule_hour !== undefined) patch['dream.schedule_hour'] = Number(schedule_hour);
  if (timezone !== undefined) patch['dream.timezone'] = String(timezone);
  if (Object.keys(patch).length > 0) await updateSettings(patch);
  return getDreamConfig();
}

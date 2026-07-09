import { sql } from '../../db';
import { clampLimit } from '../core/utils';
import { getSettings as getSettingsBatch, updateSettings } from '../config/settings';
import { getRecallStats, getDreamRecallReview } from '../recall/recallAnalytics';
import { getWriteEventStats } from '../memory/writeEvents';
import { bootView } from '../memory/boot';
import { createNode, updateNodeByPath, deleteNodeByPath, moveNode } from '../memory/write';
import { addGlossaryKeyword, removeGlossaryKeyword } from '../search/glossary';
import {
  loadLlmConfig,
  loadGuidanceFile,
  runDreamAgentLoop,
  rewriteDreamNarrative,
  parseUri,
  DREAM_EVENT_CONTEXT,
  type DreamInitialContext,
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
  raw_narrative: string | null;
  poetic_narrative: string | null;
  error: string | null;
  tool_calls?: Array<Record<string, unknown>>;
  details?: Record<string, unknown>;
  workflow_events?: DreamWorkflowEvent[];
  memory_changes?: Array<{
    id: number;
    type: string;
    uri: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    at: string | null;
    review_status: DreamChangeReviewStatus;
    reviewed_at: string | null;
  }>;
}

interface DreamConfig {
  enabled: boolean;
  schedule_hour: number;
  last_run_date: string | null;
}

interface DreamResult {
  id: number;
  status: string;
  duration_ms: number;
  summary: Record<string, unknown>;
  narrative: string;
  raw_narrative: string;
  poetic_narrative: string;
}

type DreamChangeReviewStatus = 'pending' | 'approved' | 'dismissed';

const DREAM_CHANGE_REVIEW_STATUSES = new Set<DreamChangeReviewStatus>(['pending', 'approved', 'dismissed']);

function normalizeDreamChangeReviewStatus(status: unknown): DreamChangeReviewStatus {
  const value = String(status || '').trim();
  if (DREAM_CHANGE_REVIEW_STATUSES.has(value as DreamChangeReviewStatus)) {
    return value as DreamChangeReviewStatus;
  }
  throw Object.assign(new Error(`Unsupported dream review status: ${value || '(empty)'}`), { status: 400 });
}

function formatReviewDate(value: unknown): string | null {
  if (!value) return null;
  try {
    return new Date(value as string).toISOString();
  } catch {
    return null;
  }
}

function dreamReviewFromDetails(details: unknown): { status: DreamChangeReviewStatus; reviewed_at: string | null } {
  const record = details && typeof details === 'object' ? details as Record<string, unknown> : {};
  const review = record.dream_review && typeof record.dream_review === 'object'
    ? record.dream_review as Record<string, unknown>
    : {};
  const rawStatus = String(review.status || '').trim();
  const status = DREAM_CHANGE_REVIEW_STATUSES.has(rawStatus as DreamChangeReviewStatus)
    ? rawStatus as DreamChangeReviewStatus
    : 'pending';
  return {
    status,
    reviewed_at: formatReviewDate(review.reviewed_at),
  };
}

function buildDreamReviewPayload(status: DreamChangeReviewStatus, source: 'web' | 'auto' | 'system'): Record<string, unknown> {
  return {
    status,
    source,
    reviewed_at: new Date().toISOString(),
  };
}

async function dreamAutoApproveChanges(): Promise<boolean> {
  try {
    const settings = await getSettingsBatch(['dream.auto_approve_changes']);
    return settings?.['dream.auto_approve_changes'] === true;
  } catch {
    return false;
  }
}

async function initializeDreamChangeReviews(diaryId: number, autoApprove: boolean): Promise<void> {
  const payload = buildDreamReviewPayload(autoApprove ? 'approved' : 'pending', autoApprove ? 'auto' : 'system');
  await sql(
    `UPDATE memory_events
     SET details = jsonb_set(COALESCE(details, '{}'::jsonb), '{dream_review}', $2::jsonb, true)
     WHERE source = 'dream:auto'
       AND created_at >= (SELECT started_at FROM dream_diary WHERE id = $1)
       AND created_at <= COALESCE((SELECT completed_at FROM dream_diary WHERE id = $1), NOW())
       AND NOT (COALESCE(details, '{}'::jsonb) ? 'dream_review')`,
    [diaryId, JSON.stringify(payload)],
  );
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
  let currentPhase = 'initializing';
  let activeLlmConfig: Awaited<ReturnType<typeof loadLlmConfig>> | null = null;

  // Insert diary row
  const insertResult = await sql(
    `INSERT INTO dream_diary (started_at, status) VALUES (NOW(), 'running') RETURNING id`,
  );
  const diaryId = Number(insertResult.rows[0].id);
  await appendDreamWorkflowEvent(diaryId, 'run_started', { diary_id: diaryId });

  try {
    // Step 1: Data collection
    currentPhase = 'data_collection';
    console.log('[dream] step 1: data collection');
    await appendDreamWorkflowEvent(diaryId, 'phase_started', { phase: 'data_collection', label: 'Data collection' });
    const [boot, recallStats, recallReview, writeStats] = await Promise.all([
      bootView({ client_type: 'admin' }),
      getRecallStats({ days: 1, limit: 20 }),
      getDreamRecallReview({ days: 1, limit: 100 }),
      getWriteEventStats({ days: 1, limit: 20 }),
    ]);
    const recallReviewRecord = recallReview as unknown as Record<string, unknown>;
    const recallReviewSummaryRecord = (recallReviewRecord.summary as Record<string, unknown>) || {};
    await appendDreamWorkflowEvent(diaryId, 'phase_completed', {
      phase: 'data_collection',
      label: 'Data collection',
      summary: {
        boot_loaded: (boot.core_memories || []).length,
        recall_queries: ((recallStats as Record<string, unknown>).summary as Record<string, unknown>)?.query_count || 0,
        metadata_queries: recallReviewSummaryRecord.returned_queries || 0,
        total_merged: recallReviewSummaryRecord.total_merged || 0,
        write_events: ((writeStats as unknown as Record<string, unknown>).summary as Record<string, unknown>)?.total_events || 0,
      },
    });

    // Fetch recent diaries so the agent knows what was already done
    const recentDiariesResult = await sql(
      `SELECT started_at, status, COALESCE(raw_narrative, narrative) AS narrative, tool_calls FROM dream_diary
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

    const initialContext: DreamInitialContext = {
      bootBaseline: (boot.nodes || []).map((node) => ({
        uri: node.uri,
        role_label: node.role_label,
        purpose: node.purpose,
        scope: node.scope,
        client_type: node.client_type,
        state: node.state,
        content: node.content || '',
      })),
      guidance: await loadGuidanceFile(),
      recallReview: recallReview as unknown as Record<string, unknown>,
      recallStats: recallStats as unknown as Record<string, unknown>,
      writeActivity: writeStats as unknown as Record<string, unknown>,
      recentDiaries,
    };

    // Step 2: LLM agent loop
    currentPhase = 'agent_loop';
    console.log('[dream] step 2: agent loop');
    await appendDreamWorkflowEvent(diaryId, 'phase_started', { phase: 'agent_loop', label: 'Agent loop' });
    const llmConfig = await loadLlmConfig();
    activeLlmConfig = llmConfig;
    let agentResult: { narrative: string; toolCalls: ToolCallLogEntry[]; turns: number } = {
      narrative: '(LLM not configured — skipped agent loop)',
      toolCalls: [],
      turns: 0,
    };
    if (llmConfig) {
      agentResult = await runDreamAgentLoop(llmConfig, initialContext, {
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

    let rawNarrative = agentResult.narrative.trim();
    if (!rawNarrative) rawNarrative = '(empty raw diary)';
    let poeticNarrative = rawNarrative;
    if (llmConfig) {
      currentPhase = 'poetic_rewrite';
      console.log('[dream] step 3: diary rewrite');
      await appendDreamWorkflowEvent(diaryId, 'phase_started', { phase: 'poetic_rewrite', label: 'Diary' });
      try {
        poeticNarrative = await rewriteDreamNarrative(llmConfig, rawNarrative);
        await appendDreamWorkflowEvent(diaryId, 'phase_completed', {
          phase: 'poetic_rewrite',
          label: 'Diary',
          summary: { fallback: false },
        });
      } catch (rewriteError: unknown) {
        poeticNarrative = rawNarrative;
        await appendDreamWorkflowEvent(diaryId, 'phase_completed', {
          phase: 'poetic_rewrite',
          label: 'Diary',
          summary: { fallback: true, error: (rewriteError as Error).message },
        });
      }
    }

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

    const writeSummary = (writeStats as unknown as Record<string, unknown>).summary as Record<string, unknown> | undefined;
    const recallSummary = (recallStats as unknown as Record<string, unknown>).summary as Record<string, unknown> | undefined;
    const recallReviewSummary = recallReviewSummaryRecord;
    const recallMetadataItems = Array.isArray(recallReviewRecord.queries)
      ? (recallReviewRecord.queries as Record<string, unknown>[])
      : [];
    const memoryEventsTotal = Object.values(memoryChangeCounts).reduce((sum, count) => sum + Number(count || 0), 0);
    const durableCreates = Number(memoryChangeCounts.create || 0);
    const durableEnrichments = Number(memoryChangeCounts.update || 0) + Number(memoryChangeCounts.glossary_add || 0);
    const maintenanceEvents = memoryEventsTotal - durableCreates - durableEnrichments;

    // Step 4: Save diary
    const summary: Record<string, unknown> = {
      recall_metadata: {
        returned_queries: recallReviewSummary?.returned_queries || 0,
        total_merged: recallReviewSummary?.total_merged || 0,
        total_shown: recallReviewSummary?.total_shown || 0,
        total_used: recallReviewSummary?.total_used || 0,
        truncated: recallReviewSummary?.truncated === true,
      },
      durable_extraction: {
        created: durableCreates,
        enriched: durableEnrichments,
      },
      maintenance: {
        events: maintenanceEvents,
      },
      structure: {
        moved: Number(memoryChangeCounts.move || 0),
        protected_blocks: protectedBlocks,
        policy_blocks: policyBlocks,
        policy_warnings: policyWarnings,
      },
      activity: {
        recall_events: recallSummary?.merged_count || 0,
        recall_queries: recallSummary?.query_count || 0,
        metadata_queries: recallReviewSummary?.returned_queries || 0,
        write_events: writeSummary?.total_events || 0,
      },
      agent: { tool_calls: agentResult.toolCalls.length, turns: agentResult.turns },
    };

    const durationMs = Date.now() - startedAt;
    await sql(
      `UPDATE dream_diary SET status = 'completed', completed_at = NOW(), duration_ms = $2,
       summary = $3::jsonb, narrative = $4, raw_narrative = $5, poetic_narrative = $6, tool_calls = $7::jsonb, details = $8::jsonb
       WHERE id = $1`,
      [diaryId, durationMs, JSON.stringify(summary), poeticNarrative, rawNarrative, poeticNarrative, JSON.stringify(agentResult.toolCalls), JSON.stringify({
        initial_context: initialContext,
        recallReview,
        recall_metadata_queries: recallMetadataItems.slice(0, 100),
        writeStats,
        maintenance: {
          protected_blocks: protectedBlocks,
          policy_blocks: policyBlocks,
          policy_warnings: policyWarnings,
          moved: Number(memoryChangeCounts.move || 0),
        },
        durable_extraction: {
          created: durableCreates,
          enriched: durableEnrichments,
        },
      })],
    );
    await initializeDreamChangeReviews(diaryId, await dreamAutoApproveChanges());
    await appendDreamWorkflowEvent(diaryId, 'run_completed', {
      duration_ms: durationMs,
      summary,
      tool_calls: agentResult.toolCalls.length,
      turns: agentResult.turns,
    });

    console.log(`[dream] completed in ${(durationMs / 1000).toFixed(1)}s, ${agentResult.toolCalls.length} tool calls`);
    return {
      id: diaryId,
      status: 'completed',
      duration_ms: durationMs,
      summary,
      narrative: poeticNarrative,
      raw_narrative: rawNarrative,
      poetic_narrative: poeticNarrative,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startedAt;
    await sql(
      `UPDATE dream_diary SET status = 'error', completed_at = NOW(), duration_ms = $2, error = $3 WHERE id = $1`,
      [diaryId, durationMs, (err as Error).message],
    ).catch(() => {});
    await appendDreamWorkflowEvent(diaryId, 'run_failed', {
      duration_ms: durationMs,
      phase: currentPhase,
      provider: activeLlmConfig?.provider || null,
      model: activeLlmConfig?.model || null,
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
    sql(`SELECT id, started_at, completed_at, duration_ms, status, summary, narrative, raw_narrative, poetic_narrative, error FROM dream_diary ORDER BY started_at DESC LIMIT $1 OFFSET $2`, [safeLimit, safeOffset]),
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
      `SELECT id, event_type, node_uri, before_snapshot, after_snapshot, details, created_at
       FROM memory_events
       WHERE source = 'dream:auto'
         AND created_at >= $1
         AND ($2::timestamptz IS NULL OR created_at <= $2)
       ORDER BY created_at ASC`,
      [entry.started_at, entry.completed_at],
    );
    entry.memory_changes = eventsResult.rows.map((r: Record<string, unknown>) => {
      const review = dreamReviewFromDetails(r.details);
      return {
        id: Number(r.id || 0),
        type: r.event_type as string,
        uri: r.node_uri as string,
        before: (r.before_snapshot as Record<string, unknown>) || null,
        after: (r.after_snapshot as Record<string, unknown>) || null,
        at: r.created_at ? new Date(r.created_at as string).toISOString() : null,
        review_status: review.status,
        reviewed_at: review.reviewed_at,
      };
    });
  }

  return entry;
}

function formatDiaryRow(row: Record<string, unknown>, includeDetails = false): DiaryEntry {
  const legacyNarrative = (row.narrative as string) || null;
  const rawNarrative = (row.raw_narrative as string) || legacyNarrative;
  const poeticNarrative = (row.poetic_narrative as string) || legacyNarrative || rawNarrative;
  const entry: DiaryEntry = {
    id: Number(row.id),
    started_at: row.started_at ? new Date(row.started_at as string).toISOString() : null,
    completed_at: row.completed_at ? new Date(row.completed_at as string).toISOString() : null,
    duration_ms: (row.duration_ms as number) || null,
    status: row.status as string,
    summary: (row.summary as Record<string, unknown>) || {},
    narrative: poeticNarrative || legacyNarrative || rawNarrative,
    raw_narrative: rawNarrative,
    poetic_narrative: poeticNarrative,
    error: (row.error as string) || null,
  };
  if (includeDetails) {
    entry.tool_calls = (row.tool_calls as Array<Record<string, unknown>>) || [];
    entry.details = (row.details as Record<string, unknown>) || {};
  }
  return entry;
}

export async function reviewDreamChange({
  eventId,
  status,
}: {
  eventId: number | string;
  status: string;
}): Promise<{ event_id: number; status: DreamChangeReviewStatus; reviewed_at: string | null }> {
  const safeEventId = Number(eventId);
  if (!Number.isFinite(safeEventId) || safeEventId <= 0) {
    throw Object.assign(new Error('Invalid dream change event id'), { status: 400 });
  }
  const reviewStatus = normalizeDreamChangeReviewStatus(status);
  const payload = buildDreamReviewPayload(reviewStatus, 'web');
  const result = await sql(
    `UPDATE memory_events
     SET details = jsonb_set(COALESCE(details, '{}'::jsonb), '{dream_review}', $2::jsonb, true)
     WHERE id = $1
       AND source = 'dream:auto'
     RETURNING id, details`,
    [safeEventId, JSON.stringify(payload)],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw Object.assign(new Error('Dream change not found'), { status: 404 });
  }
  const review = dreamReviewFromDetails(row.details);
  return {
    event_id: Number(row.id || safeEventId),
    status: review.status,
    reviewed_at: review.reviewed_at,
  };
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
  const s = await getSettingsBatch(['dream.enabled', 'dream.cron']);
  let lastRunDate: string | null = null;
  try {
    const r = await sql(`SELECT value FROM app_settings WHERE key = 'dream.last_run_date'`);
    lastRunDate = (r.rows[0]?.value as Record<string, unknown>)?.value as string || null;
  } catch {}
  return {
    enabled: s['dream.enabled'] !== false,
    schedule_hour: Number(String(s['dream.cron'] || '0 3 * * *').trim().split(/\s+/)[1] ?? 3),
    last_run_date: lastRunDate,
  };
}

export async function updateDreamConfig({ enabled, schedule_hour }: {
  enabled?: boolean;
  schedule_hour?: number;
} = {}): Promise<DreamConfig> {
  const patch: Record<string, unknown> = {};
  if (enabled !== undefined) patch['dream.enabled'] = enabled;
  if (schedule_hour !== undefined) patch['dream.cron'] = `0 ${Number(schedule_hour)} * * *`;
  if (Object.keys(patch).length > 0) await updateSettings(patch);
  return getDreamConfig();
}

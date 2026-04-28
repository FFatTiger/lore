import type { FormattedEvent } from './writeEvents';

export type HistoryDiffKind = 'text' | 'value' | 'keyword_add' | 'keyword_remove';

export interface HistoryDiff {
  field: string;
  kind: HistoryDiffKind;
  before: unknown;
  after: unknown;
}

export interface NormalizedHistoryEvent extends FormattedEvent {
  diffs: HistoryDiff[];
  rollback_supported: boolean;
  is_rollback: boolean;
  summary: string;
}

export interface NodeHistoryPayload {
  node_uri: string;
  events: NormalizedHistoryEvent[];
}

function snapshotValue(snapshot: Record<string, unknown> | null, field: string): unknown {
  return snapshot ? snapshot[field] ?? null : null;
}

function addChangedSnapshotDiff(
  diffs: HistoryDiff[],
  beforeSnapshot: Record<string, unknown> | null,
  afterSnapshot: Record<string, unknown> | null,
  field: 'content' | 'disclosure' | 'priority',
  kind: HistoryDiffKind,
) {
  const before = snapshotValue(beforeSnapshot, field);
  const after = snapshotValue(afterSnapshot, field);
  if (before !== after) {
    diffs.push({ field, kind, before, after });
  }
}

function numericRollbackId(details: Record<string, unknown>): number | null {
  const value = details.rollback_from_event_id;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeHistoryEvent(event: FormattedEvent): NormalizedHistoryEvent {
  const diffs: HistoryDiff[] = [];
  const beforeSnapshot = event.before_snapshot;
  const afterSnapshot = event.after_snapshot;

  if (event.event_type === 'glossary_add') {
    diffs.push({
      field: 'glossary_keywords',
      kind: 'keyword_add',
      before: null,
      after: snapshotValue(afterSnapshot, 'keyword'),
    });
  } else if (event.event_type === 'glossary_remove') {
    diffs.push({
      field: 'glossary_keywords',
      kind: 'keyword_remove',
      before: snapshotValue(beforeSnapshot, 'keyword'),
      after: null,
    });
  } else if (event.event_type === 'move') {
    diffs.push({
      field: 'uri',
      kind: 'value',
      before: event.details.old_uri ?? snapshotValue(beforeSnapshot, 'uri'),
      after: event.details.new_uri ?? snapshotValue(afterSnapshot, 'uri'),
    });
  } else if (['update', 'create', 'delete'].includes(event.event_type)) {
    addChangedSnapshotDiff(diffs, beforeSnapshot, afterSnapshot, 'content', 'text');
    addChangedSnapshotDiff(diffs, beforeSnapshot, afterSnapshot, 'disclosure', 'text');
    addChangedSnapshotDiff(diffs, beforeSnapshot, afterSnapshot, 'priority', 'value');
  }

  const rollbackId = numericRollbackId(event.details);

  return {
    ...event,
    diffs,
    rollback_supported: event.event_type === 'update' || event.event_type === 'create',
    is_rollback: rollbackId !== null,
    summary: rollbackId !== null ? `rollback from #${rollbackId}` : event.event_type,
  };
}

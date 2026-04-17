export function fmt(value: unknown, digits = 3): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

export function trunc(value: unknown, maxChars = 120): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '—';
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

export function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export interface ItemWithCues {
  cues?: unknown[];
  cue_terms?: unknown[];
}

export function readCueList(item: ItemWithCues | null | undefined, max = 4): string[] {
  const cues = Array.isArray(item?.cues)
    ? item.cues
    : Array.isArray(item?.cue_terms)
      ? item.cue_terms
      : [];
  return (cues as unknown[])
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, max);
}

interface RecallItem extends ItemWithCues {
  score_display?: number | null;
  score?: number | string | null;
  uri?: string;
  read?: boolean;
}

export function formatRecallBlock(items: RecallItem[], precision = 2): string {
  if (!Array.isArray(items) || items.length === 0) return '';
  const lines = ['<recall>'];
  for (const item of items) {
    const score = Number.isFinite(item?.score_display)
      ? Number(item.score_display).toFixed(precision)
      : String(item?.score ?? '');
    const cues = readCueList(item, 3);
    const cueText = `${item?.read ? 'read · ' : ''}${cues.join(' · ')}`.trim();
    lines.push(`${score} | ${item?.uri || ''}${cueText ? ` | ${cueText}` : ''}`);
  }
  lines.push('</recall>');
  return lines.join('\n');
}

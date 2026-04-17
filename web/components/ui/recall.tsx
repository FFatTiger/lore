'use client';

import React from 'react';
import { Badge, type BadgeTone } from './controls';
import { readCueList, type ItemWithCues } from './formatters';

interface BreakdownPart {
  key: string;
  label: string;
  tone: BadgeTone;
}

const BREAKDOWN_PARTS: BreakdownPart[] = [
  { key: 'exact', label: '精确', tone: 'orange' },
  { key: 'glossary_semantic', label: '术语', tone: 'teal' },
  { key: 'semantic', label: '语义', tone: 'purple' },
  { key: 'lexical', label: '词法', tone: 'green' },
  { key: 'recency', label: '时间', tone: 'blue' },
  { key: 'view', label: '视图', tone: 'default' },
  { key: 'priority', label: '优先', tone: 'default' },
  { key: 'multi_view', label: '多视图', tone: 'default' },
];

interface BreakdownGridProps {
  breakdown?: Record<string, unknown> | null;
}

export function BreakdownGrid({ breakdown }: BreakdownGridProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {BREAKDOWN_PARTS.map((part) => {
        const value = breakdown?.[part.key];
        const formatted = Number.isFinite(Number(value)) ? Number(value).toFixed(3) : '—';
        const dim = !Number.isFinite(Number(value)) || Number(value) === 0;
        return (
          <Badge key={part.key} tone={dim ? 'soft' : part.tone}>
            <span className="opacity-70">{part.label}</span>
            <span className="tabular-nums">{formatted}</span>
          </Badge>
        );
      })}
    </div>
  );
}

interface CueListProps {
  item: ItemWithCues | null | undefined;
}

export function CueList({ item }: CueListProps): React.JSX.Element {
  const cues = readCueList(item);
  if (!cues.length) return <span className="text-txt-quaternary">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {cues.map((cue) => (
        <span key={cue} className="inline-flex rounded-md bg-fill-quaternary px-1.5 py-[2px] text-[11px] text-txt-secondary">{cue}</span>
      ))}
    </div>
  );
}

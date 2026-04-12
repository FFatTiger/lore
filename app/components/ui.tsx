'use client';

import React, { ReactNode, ComponentPropsWithoutRef, ElementType } from 'react';
import clsx from 'clsx';

/* ── formatters ───────────────────────────────────────────────────────── */

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

interface ItemWithCues {
  cues?: unknown[];
  cue_terms?: unknown[];
}

export function readCueList(item: ItemWithCues | null | undefined, max = 4): string[] {
  const cues = Array.isArray(item?.cues)
    ? item!.cues
    : Array.isArray(item?.cue_terms)
      ? item!.cue_terms
      : [];
  return (cues as unknown[]).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, max);
}

interface RecallItem {
  score_display?: number | null;
  score?: number | string | null;
  uri?: string;
  read?: boolean;
  cues?: unknown[];
  cue_terms?: unknown[];
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

/* ── layout ───────────────────────────────────────────────────────────── */

type MaxWidth = '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full';

interface PageCanvasProps {
  children: ReactNode;
  maxWidth?: MaxWidth;
  className?: string;
  /** DreamPage passes size="5xl" — accept it as an alias for maxWidth */
  size?: MaxWidth;
}

/**
 * PageCanvas — standard Apple-style page wrapper. Generous top padding,
 * wide max-width container. Content fades up on mount.
 */
export function PageCanvas({ children, maxWidth, size, className }: PageCanvasProps): React.JSX.Element {
  const mw = maxWidth ?? size ?? '5xl';
  return (
    <div className="h-full w-full overflow-y-auto">
      <div className={clsx('mx-auto w-full px-4 py-6 md:px-10 md:py-14', {
        'max-w-3xl': mw === '3xl',
        'max-w-4xl': mw === '4xl',
        'max-w-5xl': mw === '5xl',
        'max-w-6xl': mw === '6xl',
        'max-w-7xl': mw === '7xl',
        'max-w-full': mw === 'full',
      }, className)}>
        {children}
      </div>
    </div>
  );
}

interface PageTitleProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
}

/**
 * PageTitle — large SF Pro Display-style title with optional eyebrow.
 */
export function PageTitle({ eyebrow, title, description, right }: PageTitleProps): React.JSX.Element {
  return (
    <div className="mb-6 md:mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6 animate-in">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 md:mb-2 text-[11px] md:text-[12px] font-medium uppercase tracking-[0.08em] text-sys-blue">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-[28px] sm:text-[34px] md:text-[48px] font-bold leading-[1.1] tracking-[-0.02em] text-txt-primary">
          {title}
        </h1>
        {description && (
          <p className="mt-2 md:mt-3 text-[14px] md:text-[17px] leading-relaxed text-txt-secondary max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0 flex-wrap">{right}</div>}
    </div>
  );
}

interface CardProps {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  interactive?: boolean;
}

/**
 * Card — Apple-style raised surface. Large radius, subtle border.
 */
export function Card({ children, className, padded = true, interactive = false }: CardProps): React.JSX.Element {
  return (
    <div
      className={clsx(
        'rounded-2xl border border-separator-thin bg-bg-elevated shadow-card',
        padded && 'p-4 md:p-6',
        interactive && 'transition-all duration-200 ease-spring hover:border-separator hover:bg-bg-raised',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface SectionProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
}

/**
 * Section — large card with an optional header.
 */
export function Section({ title, subtitle, right, children, className, padded = true }: SectionProps): React.JSX.Element {
  const hasHeader = title !== undefined || right !== undefined;
  return (
    <section className={clsx('rounded-2xl border border-separator-thin bg-bg-elevated shadow-card overflow-hidden', className)}>
      {hasHeader && (
        <header className="flex items-end justify-between gap-3 md:gap-4 px-4 md:px-6 pt-4 md:pt-5 pb-3 md:pb-4 border-b border-separator-thin">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] md:text-[19px] font-semibold tracking-tight text-txt-primary">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[12px] md:text-[13px] text-txt-secondary">{subtitle}</p>}
          </div>
          {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
        </header>
      )}
      {children !== undefined && <div className={padded ? 'px-4 md:px-6 py-4 md:py-5' : ''}>{children}</div>}
    </section>
  );
}

/* ── buttons ───────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  className?: string;
}

export function Button({ variant = 'secondary', size = 'md', children, className, ...rest }: ButtonProps): React.JSX.Element {
  const base = 'press inline-flex items-center justify-center gap-1.5 font-medium rounded-full transition-all duration-200 ease-spring disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';
  const sizes: Record<ButtonSize, string> = {
    sm: 'h-7 px-3 text-[12px]',
    md: 'h-9 px-4 text-[13.5px]',
    lg: 'h-11 px-5 text-[15px]',
  };
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-sys-blue text-white hover:bg-[#1E90FF]',
    secondary: 'bg-fill-primary text-txt-primary hover:bg-fill-secondary',
    ghost: 'bg-transparent text-txt-secondary hover:bg-fill-quaternary hover:text-txt-primary',
    destructive: 'bg-sys-red/15 text-sys-red hover:bg-sys-red/25',
  };
  return (
    <button className={clsx(base, sizes[size], variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

/* ── chrome / atoms ───────────────────────────────────────────────────── */

type BadgeTone = 'default' | 'blue' | 'green' | 'orange' | 'red' | 'yellow' | 'purple' | 'teal' | 'soft';

const BADGE_TONES: Record<BadgeTone, string> = {
  default: 'bg-fill-tertiary text-txt-secondary',
  blue: 'bg-sys-blue/15 text-sys-blue',
  green: 'bg-sys-green/15 text-sys-green',
  orange: 'bg-sys-orange/15 text-sys-orange',
  red: 'bg-sys-red/15 text-sys-red',
  yellow: 'bg-sys-yellow/15 text-sys-yellow',
  purple: 'bg-sys-purple/15 text-sys-purple',
  teal: 'bg-sys-teal/15 text-sys-teal',
  soft: 'bg-fill-quaternary text-txt-tertiary',
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
}

export function Badge({ children, tone = 'default' }: BadgeProps): React.JSX.Element {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-[2px] text-[11px] font-medium leading-[1.4]', BADGE_TONES[tone] || BADGE_TONES.default)}>
      {children}
    </span>
  );
}

/* ── stat cards ───────────────────────────────────────────────────────── */

type StatTone = 'default' | 'blue' | 'green' | 'orange' | 'purple' | 'teal' | 'red';

const STAT_TONES: Record<StatTone, string> = {
  default: 'text-txt-primary',
  blue: 'text-sys-blue',
  green: 'text-sys-green',
  orange: 'text-sys-orange',
  purple: 'text-sys-purple',
  teal: 'text-sys-teal',
  red: 'text-sys-red',
};

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
}

export function StatCard({ label, value, hint, tone = 'default' }: StatCardProps): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-card p-5">
      <div className="text-[12px] font-medium text-txt-tertiary">{label}</div>
      <div className={clsx('mt-2 text-[32px] font-bold leading-none tracking-[-0.02em] tabular-nums', STAT_TONES[tone] || STAT_TONES.default)}>
        {value ?? '—'}
      </div>
      {hint && <div className="mt-1 text-[12px] text-txt-tertiary">{hint}</div>}
    </div>
  );
}

interface EmptyStateProps {
  text: string;
  icon?: React.ElementType<Record<string, unknown>>;
}

export function EmptyState({ text, icon: Icon }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-separator-thin py-14 text-center">
      {Icon && <Icon size={24} className="text-txt-quaternary" />}
      <p className="text-[14px] text-txt-tertiary">{text}</p>
    </div>
  );
}

/* ── table: Apple-style refined list ──────────────────────────────────── */

type RowData = Record<string, unknown>;

interface TableColumn<T extends RowData = RowData> {
  key: string;
  label: ReactNode;
  className?: string;
  render?: (value: T[string], row: T) => ReactNode;
}

function rowKey(row: RowData, index: number): string {
  const primary = String(row.uri || row.node_uri || row.query_id || row.id || '');
  const suffix = String(row.view_type || row.keyword || row.retrieval_path || '');
  return `${index}-${primary}-${suffix}`;
}

interface TableProps<T extends RowData = RowData> {
  columns: TableColumn<T>[];
  rows?: T[] | null;
  empty?: string;
  onRowClick?: (row: T) => void;
  activeRowKey?: string;
}

export function Table<T extends RowData = RowData>({ columns, rows, empty = '暂无数据', onRowClick, activeRowKey }: TableProps<T>): React.JSX.Element {
  if (!rows?.length) return <EmptyState text={empty} />;
  return (
    <div className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-card overflow-hidden">
      <div className="w-full overflow-x-auto">
        <table className="min-w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-separator-thin">
              {columns.map((col) => (
                <th key={col.key} className={clsx("px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary align-middle", col.className)}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const key = rowKey(row as RowData, i);
              const active = activeRowKey && activeRowKey === (row.uri || row.node_uri);
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={clsx(
                    'border-b border-separator-thin last:border-b-0 align-top transition-colors duration-150',
                    active ? 'bg-sys-blue/[0.08]' : onRowClick && 'hover:bg-fill-quaternary',
                    onRowClick && 'cursor-pointer',
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={clsx("px-4 py-3 text-[13px] text-txt-primary", col.className)}>
                      {col.render ? col.render(row[col.key] as T[string], row) : String(row[col.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── score breakdown ──────────────────────────────────────────────────── */

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
      {BREAKDOWN_PARTS.map((p) => {
        const v = breakdown?.[p.key];
        const val = Number.isFinite(Number(v)) ? Number(v).toFixed(3) : '—';
        const dim = !Number.isFinite(Number(v)) || Number(v) === 0;
        return (
          <Badge key={p.key} tone={dim ? 'soft' : p.tone}>
            <span className="opacity-70">{p.label}</span>
            <span className="tabular-nums">{val}</span>
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
      {cues.map((c) => (
        <span key={c} className="inline-flex rounded-md bg-fill-quaternary px-1.5 py-[2px] text-[11px] text-txt-secondary">{c}</span>
      ))}
    </div>
  );
}

/* ── shared input classes ──────────────────────────────────────────────── */

export const inputClass = 'w-full rounded-lg border border-separator-thin bg-bg-raised px-3 py-1.5 text-[13px] font-mono text-txt-primary placeholder:text-txt-quaternary focus:border-sys-blue/60 focus:bg-bg-surface focus:outline-none';

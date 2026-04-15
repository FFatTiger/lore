'use client';

import React, { ReactNode, ComponentPropsWithoutRef, ElementType, useMemo } from 'react';
import clsx from 'clsx';
import * as Accordion from '@radix-ui/react-accordion';
import * as Select from '@radix-ui/react-select';
import * as Tabs from '@radix-ui/react-tabs';
import { ChevronDown } from 'lucide-react';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';

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
  titleText?: string;
  truncateTitle?: boolean;
}

/**
 * PageTitle — large SF Pro Display-style title with optional eyebrow.
 */
export function PageTitle({ eyebrow, title, description, right, titleText, truncateTitle = false }: PageTitleProps): React.JSX.Element {
  const resolvedTitleText = titleText ?? (typeof title === 'string' || typeof title === 'number' ? String(title) : undefined);
  return (
    <div className="mb-6 md:mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6 animate-in">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="mb-1.5 md:mb-2 text-[11px] md:text-[12px] font-medium uppercase tracking-[0.08em] text-sys-blue">
            {eyebrow}
          </div>
        )}
        <h1
          className={clsx(
            'font-display text-[26px] sm:text-[32px] md:text-[42px] font-bold leading-[1.1] tracking-[-0.02em] text-txt-primary min-w-0',
            truncateTitle && 'overflow-hidden whitespace-nowrap text-ellipsis',
          )}
          title={truncateTitle ? resolvedTitleText : undefined}
        >
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
  default: 'border border-separator-thin bg-fill-secondary text-txt-secondary',
  blue: 'border border-sys-blue/20 bg-sys-blue/12 text-sys-blue',
  green: 'border border-sys-green/20 bg-sys-green/12 text-sys-green',
  orange: 'border border-sys-orange/22 bg-sys-orange/12 text-sys-orange',
  red: 'border border-sys-red/20 bg-sys-red/12 text-sys-red',
  yellow: 'border border-sys-yellow/28 bg-sys-yellow/14 text-sys-yellow',
  purple: 'border border-sys-purple/20 bg-sys-purple/12 text-sys-purple',
  teal: 'border border-sys-teal/20 bg-sys-teal/12 text-sys-teal',
  soft: 'border border-separator-thin bg-fill-quaternary text-txt-tertiary',
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}

export function Badge({ children, tone = 'default', dot = false }: BadgeProps): React.JSX.Element {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-[2px] text-[11px] font-medium leading-[1.4]', BADGE_TONES[tone] || BADGE_TONES.default)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />}
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
  compact?: boolean;
}

export function StatCard({ label, value, hint, tone = 'default', compact = false }: StatCardProps): React.JSX.Element {
  return (
    <div className={clsx('rounded-2xl border border-separator-thin bg-bg-elevated shadow-card', compact ? 'p-4' : 'p-5')}>
      <div className={clsx('font-medium text-txt-tertiary', compact ? 'text-[11px]' : 'text-[12px]')}>{label}</div>
      <div className={clsx(compact ? 'mt-1.5 text-[26px]' : 'mt-2 text-[32px]', 'font-bold leading-none tracking-[-0.02em] tabular-nums', STAT_TONES[tone] || STAT_TONES.default)}>
        {value ?? '—'}
      </div>
      {hint && <div className={clsx('text-txt-tertiary', compact ? 'mt-1 text-[11px]' : 'mt-1 text-[12px]')}>{hint}</div>}
    </div>
  );
}

interface NoticeProps {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  icon?: ReactNode;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

const NOTICE_TONES: Record<NonNullable<NoticeProps['tone']>, string> = {
  info: 'border-sys-blue/18 bg-sys-blue/10 text-sys-blue',
  warning: 'border-sys-orange/22 bg-sys-orange/10 text-sys-orange',
  danger: 'border-sys-red/20 bg-sys-red/10 text-sys-red',
  success: 'border-sys-green/20 bg-sys-green/10 text-sys-green',
};

export function Notice({ tone = 'info', icon, title, children, className }: NoticeProps): React.JSX.Element {
  return (
    <div className={clsx('flex items-start gap-3 rounded-xl border px-4 py-3', NOTICE_TONES[tone], className)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0">
        {title && <div className="text-[12px] font-semibold uppercase tracking-[0.06em]">{title}</div>}
        <div className={clsx('text-[13px] leading-relaxed', title && 'mt-1')}>{children}</div>
      </div>
    </div>
  );
}

interface EmptyStateProps {
  text: string;
  icon?: React.ElementType<Record<string, unknown>>;
}

interface SelectOption {
  value: string;
  label: ReactNode;
}

interface AppSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: ReactNode;
  className?: string;
}

export function AppSelect({ value, onValueChange, options, placeholder, className }: AppSelectProps): React.JSX.Element {
  const selected = options.find((option) => option.value === value);
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger className={clsx(inputClass, 'inline-flex items-center justify-between gap-2 font-sans', className)}>
        <Select.Value>{selected?.label || placeholder || '—'}</Select.Value>
        <Select.Icon>
          <ChevronDown size={14} className="text-txt-quaternary" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={8}
          className="z-[120] overflow-hidden rounded-xl border border-separator-thin bg-bg-elevated shadow-card backdrop-blur-xl"
        >
          <Select.Viewport className="p-1.5">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className="cursor-pointer rounded-lg px-3 py-2 text-[13px] text-txt-primary outline-none transition-colors data-[highlighted]:bg-fill-primary data-[state=checked]:text-sys-blue"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

interface DisclosureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Disclosure({ open, onOpenChange, trigger, children, className }: DisclosureProps): React.JSX.Element {
  return (
    <Accordion.Root type="single" collapsible value={open ? 'open' : undefined} onValueChange={(value) => onOpenChange(value === 'open')} className={className}>
      <Accordion.Item value="open" className="border-none">
        <Accordion.Trigger asChild>
          <button type="button" className="w-full text-left">{trigger}</button>
        </Accordion.Trigger>
        <Accordion.Content>{children}</Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  );
}

interface SegmentedTabOption {
  value: string;
  label: ReactNode;
}

interface SegmentedTabsProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentedTabOption[];
  className?: string;
}

export function SegmentedTabs({ value, onValueChange, options, className }: SegmentedTabsProps): React.JSX.Element {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange} className={className}>
      <Tabs.List className="flex items-center gap-1">
        {options.map((option) => (
          <Tabs.Trigger
            key={option.value}
            value={option.value}
            className="press rounded-full border px-3 py-1 text-[12px] font-medium text-txt-secondary transition-all data-[state=active]:border-sys-blue/15 data-[state=active]:bg-bg-elevated data-[state=active]:text-sys-blue data-[state=active]:shadow-sm hover:bg-fill-quaternary hover:text-txt-primary"
          >
            {option.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
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
  const data = useMemo(() => rows || [], [rows]);
  const tableColumns = useMemo(() => columns.map((col) => ({
    id: col.key,
    accessorFn: (row: T) => row[col.key],
    header: () => col.label,
    cell: ({ row }: { row: { original: T } }) => (col.render ? col.render(row.original[col.key] as T[string], row.original) : String(row.original[col.key] ?? '—')),
    meta: { className: col.className },
  })), [columns]);
  const table = useReactTable({ data, columns: tableColumns, getCoreRowModel: getCoreRowModel() });
  if (!data.length) return <EmptyState text={empty} />;
  return (
    <div className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-card overflow-hidden">
      <div className="w-full overflow-x-auto">
        <table className="min-w-full border-collapse text-left">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-separator">
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className={clsx('px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary align-middle', (header.column.columnDef.meta as { className?: string } | undefined)?.className)}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => {
              const original = row.original as T & RowData;
              const key = rowKey(original, i);
              const active = activeRowKey && activeRowKey === (original.uri || original.node_uri);
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={clsx(
                    'border-b border-separator-thin last:border-b-0 align-top transition-colors duration-150 even:bg-fill-quaternary/30',
                    active ? 'bg-sys-blue/[0.12]' : onRowClick && 'hover:bg-fill-primary/80',
                    onRowClick && 'cursor-pointer',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={clsx('px-4 py-3 text-[13px] text-txt-primary', (cell.column.columnDef.meta as { className?: string } | undefined)?.className)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
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

export const inputClass = 'w-full rounded-lg border border-separator bg-bg-raised px-3 py-2 text-[13px] font-mono text-txt-primary placeholder:text-txt-quaternary shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] hover:border-separator hover:bg-bg-surface focus:border-sys-blue focus:bg-bg-elevated focus:ring-2 focus:ring-sys-blue/20 focus:outline-none';

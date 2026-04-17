'use client';

import React, { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import clsx from 'clsx';
import * as Accordion from '@radix-ui/react-accordion';
import * as Select from '@radix-ui/react-select';
import * as Tabs from '@radix-ui/react-tabs';
import { ChevronDown } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

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

export type BadgeTone = 'default' | 'blue' | 'green' | 'orange' | 'red' | 'yellow' | 'purple' | 'teal' | 'soft';

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
  className?: string;
}

export function Badge({ children, tone = 'default', dot = false, className }: BadgeProps): React.JSX.Element {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-[2px] text-[11px] font-medium leading-[1.4]', BADGE_TONES[tone] || BADGE_TONES.default, className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />}
      {children}
    </span>
  );
}

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
  icon?: ElementType<{ size?: number; className?: string }>;
}

export function EmptyState({ text, icon: Icon }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-separator-thin py-14 text-center">
      {Icon && <Icon size={24} className="text-txt-quaternary" />}
      <p className="text-[14px] text-txt-tertiary">{text}</p>
    </div>
  );
}

export const inputClass = 'w-full rounded-lg border border-separator bg-bg-raised px-3 py-2 text-[13px] font-mono text-txt-primary placeholder:text-txt-quaternary shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] hover:border-separator hover:bg-bg-surface focus:border-sys-blue focus:bg-bg-elevated focus:ring-2 focus:ring-sys-blue/20 focus:outline-none';

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

const EMPTY_SELECT_VALUE = '__empty_option__';

export function AppSelect({ value, onValueChange, options, placeholder, className }: AppSelectProps): React.JSX.Element {
  const normalizedValue = value === '' ? undefined : value;
  const selected = options.find((option) => option.value === value);
  return (
    <Select.Root value={normalizedValue} onValueChange={(next) => onValueChange(next === EMPTY_SELECT_VALUE ? '' : next)}>
      <Select.Trigger className={clsx(inputClass, 'inline-flex items-center justify-between gap-2 font-sans', className)}>
        <Select.Value placeholder={placeholder || '—'}>{selected?.label}</Select.Value>
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
            {options.map((option) => {
              const optionValue = option.value === '' ? EMPTY_SELECT_VALUE : option.value;
              return (
                <Select.Item
                  key={optionValue}
                  value={optionValue}
                  className="cursor-pointer rounded-lg px-3 py-2 text-[13px] text-txt-primary outline-none transition-colors data-[highlighted]:bg-fill-primary data-[state=checked]:text-sys-blue"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              );
            })}
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

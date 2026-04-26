'use client';

import React, { type ElementType, type Key, type ReactNode } from 'react';
import clsx from 'clsx';
import type { AccordionProps as LobeAccordionProps } from '@lobehub/ui/es/Accordion/type';
import { Accordion as LobeAccordion, AccordionItem as LobeAccordionItem } from '@lobehub/ui/es/Accordion/index';
import LobeAlert from '@lobehub/ui/es/Alert/index';
import LobeAvatar from '@lobehub/ui/es/Avatar/index';
import LobeButton from '@lobehub/ui/es/Button/index';
import type { ButtonProps as LobeButtonProps } from '@lobehub/ui/es/Button/type';
import type { AvatarProps as LobeAvatarProps } from '@lobehub/ui/es/Avatar/type';
import LobeCheckbox from '@lobehub/ui/es/Checkbox/index';
import type { CheckboxProps as LobeCheckboxProps } from '@lobehub/ui/es/Checkbox/type';
import LobeInput from '@lobehub/ui/es/Input/Input';
import LobeInputPassword from '@lobehub/ui/es/Input/InputPassword';
import LobeTextArea from '@lobehub/ui/es/Input/TextArea';
import type { InputPasswordProps as LobeInputPasswordProps, InputProps as LobeInputProps, TextAreaProps as LobeTextAreaProps } from '@lobehub/ui/es/Input/type';
import LobeSelect from '@lobehub/ui/es/Select/Select';
import LobeSegmented from '@lobehub/ui/es/Segmented/index';
import LobeTag from '@lobehub/ui/es/Tag/Tag';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<LobeButtonProps, 'size' | 'type' | 'variant'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  className?: string;
}

const BUTTON_SIZE_MAP: Record<ButtonSize, LobeButtonProps['size']> = {
  sm: 'small',
  md: 'middle',
  lg: 'large',
};

const BUTTON_VARIANT_CLASSNAMES: Record<ButtonVariant, string> = {
  primary: 'bg-sys-blue text-white hover:bg-[#1E90FF]',
  secondary: 'border border-sys-green/20 bg-sys-green/15 text-sys-green hover:bg-sys-green/20',
  ghost: 'bg-transparent text-txt-secondary hover:bg-fill-quaternary hover:text-txt-primary',
  destructive: 'bg-sys-red/15 !text-sys-red hover:bg-sys-red/25',
};

export function Button({ variant = 'secondary', size = 'md', children, className, ...rest }: ButtonProps): React.JSX.Element {
  const danger = variant === 'destructive';
  const type = variant === 'primary' || variant === 'destructive'
    ? 'primary'
    : variant === 'ghost'
      ? 'text'
      : 'default';
  const lobeVariant = variant === 'secondary' ? 'filled' : variant === 'ghost' ? 'text' : undefined;

  return (
    <LobeButton
      className={clsx('press inline-flex items-center justify-center gap-1.5 font-medium rounded-full whitespace-nowrap', BUTTON_VARIANT_CLASSNAMES[variant], className)}
      danger={danger}
      size={BUTTON_SIZE_MAP[size]}
      type={type}
      variant={lobeVariant}
      {...rest}
    >
      {children}
    </LobeButton>
  );
}

export type BadgeTone = 'default' | 'blue' | 'green' | 'orange' | 'red' | 'yellow' | 'purple' | 'teal' | 'soft';

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}

const BADGE_TAG_COLORS: Record<BadgeTone, string> = {
  default: 'default',
  blue: 'blue',
  green: 'green',
  orange: 'orange',
  red: 'red',
  yellow: 'gold',
  purple: 'purple',
  teal: 'cyan',
  soft: 'default',
};

export function Badge({ children, tone = 'default', dot = false, className }: BadgeProps): React.JSX.Element {
  return (
    <LobeTag
      className={clsx('inline-flex items-center gap-1 px-1.5 py-[2px] text-[11px] font-medium leading-[1.4]', className)}
      color={BADGE_TAG_COLORS[tone] || BADGE_TAG_COLORS.default}
      variant={tone === 'soft' ? 'borderless' : 'filled'}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />}
      {children}
    </LobeTag>
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
    <div className={clsx('rounded-2xl border border-separator-thin bg-bg-elevated shadow-card', compact ? 'p-5' : 'p-5')}>
      <div className={clsx('font-medium text-txt-tertiary', compact ? 'text-[12px]' : 'text-[12px]')}>{label}</div>
      <div className={clsx(compact ? 'mt-2 text-[30px]' : 'mt-2 text-[32px]', 'font-bold leading-none tracking-[-0.02em] tabular-nums', STAT_TONES[tone] || STAT_TONES.default)}>
        {value ?? '—'}
      </div>
      {hint && <div className={clsx('text-txt-tertiary', compact ? 'mt-1 text-[12px]' : 'mt-1 text-[12px]')}>{hint}</div>}
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

const NOTICE_TYPES: Record<NonNullable<NoticeProps['tone']>, 'info' | 'warning' | 'error' | 'success'> = {
  info: 'info',
  warning: 'warning',
  danger: 'error',
  success: 'success',
};

export function Notice({ tone = 'info', icon, title, children, className }: NoticeProps): React.JSX.Element {
  return (
    <LobeAlert
      className={className}
      description={children}
      icon={icon}
      message={title}
      showIcon={Boolean(icon)}
      type={NOTICE_TYPES[tone]}
      variant="filled"
    />
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

type AppInputProps = LobeInputProps;

export function AppInput({ className, variant = 'filled', ...rest }: AppInputProps): React.JSX.Element {
  return <LobeInput className={className} variant={variant} {...rest} />;
}

type AppPasswordInputProps = LobeInputPasswordProps;

export function AppPasswordInput({ className, variant = 'filled', ...rest }: AppPasswordInputProps): React.JSX.Element {
  return <LobeInputPassword className={className} variant={variant} {...rest} />;
}

type AppTextAreaProps = LobeTextAreaProps;

export function AppTextArea({ className, resize = true, variant = 'filled', ...rest }: AppTextAreaProps): React.JSX.Element {
  return <LobeTextArea className={className} resize={resize} variant={variant} {...rest} />;
}

type AppAvatarProps = LobeAvatarProps;

export function AppAvatar(props: AppAvatarProps): React.JSX.Element {
  return <LobeAvatar {...props} />;
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
  disabled?: boolean;
}

export function AppSelect({ value, onValueChange, options, placeholder, className, disabled = false }: AppSelectProps): React.JSX.Element {
  return (
    <LobeSelect
      className={className}
      disabled={disabled}
      options={options.map((option) => ({ label: option.label, value: option.value }))}
      placeholder={placeholder || '—'}
      style={{ width: '100%' }}
      value={value === '' ? undefined : value}
      variant="filled"
      onChange={(next: string | number | null | undefined) => onValueChange(String(next ?? ''))}
    />
  );
}

interface AppCheckboxProps extends Omit<LobeCheckboxProps, 'onChange'> {
  onValueChange?: (checked: boolean) => void;
}

export function AppCheckbox({ onValueChange, ...rest }: AppCheckboxProps): React.JSX.Element {
  return <LobeCheckbox onChange={onValueChange} {...rest} />;
}

interface DisclosureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Disclosure({ open, onOpenChange, trigger, children, className }: DisclosureProps): React.JSX.Element {
  const expandedKeys: Key[] = open ? ['open'] : [];
  const handleExpandedChange: NonNullable<LobeAccordionProps['onExpandedChange']> = (keys) => {
    onOpenChange(keys.includes('open'));
  };

  return (
    <LobeAccordion
      accordion
      className={clsx(
        'bg-transparent shadow-none [&_.ant-collapse-content]:border-0 [&_.ant-collapse-content-box]:p-0 [&_.ant-collapse-header]:p-0 [&_.ant-collapse-item]:border-0',
        className,
      )}
      expandedKeys={expandedKeys}
      hideIndicator
      onExpandedChange={handleExpandedChange}
      variant="borderless"
    >
      <LobeAccordionItem itemKey="open" title={trigger} variant="borderless">
        {children}
      </LobeAccordionItem>
    </LobeAccordion>
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
    <LobeSegmented
      className={className}
      options={options.map((option) => ({ label: option.label, value: option.value }))}
      shape="round"
      value={value}
      variant="filled"
      onChange={(next) => onValueChange(String(next))}
    />
  );
}

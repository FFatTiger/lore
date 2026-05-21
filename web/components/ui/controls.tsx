'use client';

import React, { type ButtonHTMLAttributes, type Key, type ReactNode } from 'react';
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
import * as LobeInputNumberMod from '@lobehub/ui/es/Input/InputNumber';
const LobeInputNumber = (LobeInputNumberMod as any).default ?? LobeInputNumberMod;
import LobeInputPassword from '@lobehub/ui/es/Input/InputPassword';
import LobeTextArea from '@lobehub/ui/es/Input/TextArea';
import type { InputNumberProps as LobeInputNumberProps, InputPasswordProps as LobeInputPasswordProps, InputProps as LobeInputProps, TextAreaProps as LobeTextAreaProps } from '@lobehub/ui/es/Input/type';
import LobeSelect from '@lobehub/ui/es/Select/Select';
import type { SelectProps as LobeSelectProps } from '@lobehub/ui/es/Select/type';
import LobeSegmented from '@lobehub/ui/es/Segmented/index';
import LobeTabs from '@lobehub/ui/es/Tabs/index';
import type { TabsProps as LobeTabsProps } from '@lobehub/ui/es/Tabs/type';
import LobeTag from '@lobehub/ui/es/Tag/Tag';
import LobeEmpty from '@lobehub/ui/es/Empty/index';
import LobeCopyButton from '@lobehub/ui/es/CopyButton/index';
import * as LobeSwitchMod from '@lobehub/ui/es/base-ui/Switch/Switch';
const LobeSwitch = (LobeSwitchMod as any).default ?? LobeSwitchMod;
import type { SwitchProps as LobeSwitchProps } from '@lobehub/ui/es/base-ui/Switch/type';
import LobeActionIcon from '@lobehub/ui/es/ActionIcon/index';
import { CodeDiff as LobeCodeDiff } from '@lobehub/ui/es/CodeDiff/index';
import { Dropdown as LobeDropdown, Tooltip as LobeTooltip } from '@lobehub/ui';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<LobeButtonProps, 'size' | 'type' | 'variant'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  children?: ReactNode;
  className?: string;
}

const BUTTON_SIZE_MAP: Record<ButtonSize, LobeButtonProps['size']> = {
  sm: 'small',
  md: 'middle',
  lg: 'large',
};


export function Button({ variant = 'secondary', size = 'md', block = false, children, className, ...rest }: ButtonProps): React.JSX.Element {
  const danger = variant === 'destructive';
  const type = variant === 'primary' || variant === 'destructive'
    ? 'primary'
    : variant === 'ghost'
      ? 'text'
      : 'default';
  const lobeVariant = variant === 'ghost' ? 'text' : undefined;

  return (
    <LobeButton
      className={clsx('press inline-flex items-center justify-center gap-1.5 font-medium !rounded-lg whitespace-nowrap', block && 'w-full', className)}
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

export type TextButtonTone = 'default' | 'blue' | 'danger';
export type TextButtonSize = 'sm' | 'md';

interface TextButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: TextButtonTone;
  size?: TextButtonSize;
  active?: boolean;
}

const TEXT_BUTTON_TONES: Record<TextButtonTone, string> = {
  default: 'text-txt-secondary hover:text-txt-primary',
  blue: 'text-sys-blue hover:opacity-80',
  danger: 'text-sys-red hover:opacity-80',
};

const TEXT_BUTTON_SIZES: Record<TextButtonSize, string> = {
  sm: 'text-[11px]',
  md: 'text-[13px]',
};

export function TextButton({ tone = 'blue', size = 'md', active = false, type = 'button', className, children, ...rest }: TextButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={clsx(
        'press inline-flex items-center gap-1 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        TEXT_BUTTON_SIZES[size],
        TEXT_BUTTON_TONES[tone],
        active && 'bg-sys-blue/15 font-semibold hover:opacity-100',
        !active && tone === 'default' && 'hover:bg-fill-quaternary',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

export function Spinner({ size = 'md', className, label }: SpinnerProps): React.JSX.Element {
  return (
    <span
      className={clsx(
        'inline-block animate-spin rounded-full border-2 border-fill-tertiary border-t-sys-blue',
        size === 'sm' && 'h-4 w-4',
        size === 'md' && 'h-6 w-6',
        size === 'lg' && 'h-8 w-8',
        className,
      )}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'status' : undefined}
    />
  );
}

export type BadgeTone = 'default' | 'blue' | 'green' | 'orange' | 'red' | 'yellow' | 'purple' | 'teal' | 'soft';
export type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
  mono?: boolean;
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

const BADGE_SIZE_CLASSES: Record<BadgeSize, string> = {
  xs: 'py-px px-1 text-[9px]',
  sm: 'py-0.5 px-1.5 text-[10px]',
  md: 'py-[2px] px-1.5 text-[11px]',
  lg: 'py-1 px-2.5 text-[12px]',
};

export function Badge({ children, tone = 'default', size = 'md', dot = false, mono = false, className }: BadgeProps): React.JSX.Element {
  return (
    <LobeTag
      className={clsx(
        'inline-flex items-center gap-1 font-medium',
        '!rounded-md',
        BADGE_SIZE_CLASSES[size],
        mono && 'font-mono tabular-nums',
        className,
      )}
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
    <div className={clsx(surfaceCardClassName, compact ? 'p-5' : 'p-5')}>
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
      title={title}
      showIcon={Boolean(icon)}
      type={NOTICE_TYPES[tone]}
      variant="filled"
    />
  );
}

interface EmptyProps {
  text: string;
  title?: ReactNode;
  icon?: React.FC<any>;
  emoji?: string;
  action?: ReactNode;
  className?: string;
}

export function Empty({ text, title, icon: Icon, emoji, action, className }: EmptyProps): React.JSX.Element {
  return (
    <LobeEmpty
      action={action}
      className={clsx('flex flex-col items-center justify-center text-center', className)}
      description={text}
      emoji={emoji}
      icon={Icon}
      title={title}
    />
  );
}

export const surfaceCardClassName = 'rounded-2xl border border-separator-thin bg-bg-elevated shadow-card';

type AppInputSize = 'sm' | 'md' | 'lg';

const APP_INPUT_SIZE_CLASSES: Record<AppInputSize, string> = {
  sm: 'text-[11px]',
  md: 'text-[13px]',
  lg: 'text-[14px]',
};

interface AppInputProps extends Omit<LobeInputProps, 'size'> {
  size?: AppInputSize;
  mono?: boolean;
}

export function AppInput({ className, variant = 'filled', size = 'md', mono = false, ...rest }: AppInputProps): React.JSX.Element {
  return <LobeInput className={clsx(APP_INPUT_SIZE_CLASSES[size], mono && 'font-mono tabular-nums', className)} variant={variant} {...rest} />;
}

interface AppPasswordInputProps extends Omit<LobeInputPasswordProps, 'size'> {
  size?: AppInputSize;
}

export function AppPasswordInput({ className, variant = 'filled', size = 'md', ...rest }: AppPasswordInputProps): React.JSX.Element {
  return <LobeInputPassword className={clsx(APP_INPUT_SIZE_CLASSES[size], className)} variant={variant} {...rest} />;
}

interface AppInputNumberProps extends Omit<LobeInputNumberProps, 'size'> {
  size?: AppInputSize;
}

export function AppInputNumber({ className, variant = 'filled', size = 'md', ...rest }: AppInputNumberProps): React.JSX.Element {
  return <LobeInputNumber className={clsx(APP_INPUT_SIZE_CLASSES[size], className)} variant={variant} {...rest} />;
}

interface FilterNumberFieldProps extends Omit<LobeInputNumberProps, 'size' | 'onChange' | 'value'> {
  value: number;
  onChange: (value: number | null) => void;
}

export function FilterNumberField({ className, value, onChange, variant = 'borderless', ...rest }: FilterNumberFieldProps): React.JSX.Element {
  return (
    <LobeInputNumber
      size="middle"
      value={value}
      variant={variant}
      onChange={(next: number | null | undefined) => onChange(next == null ? null : Number(next))}
      {...rest}
      className={clsx('!rounded-md', className)}
    />
  );
}

interface AppTextAreaProps extends Omit<LobeTextAreaProps, 'size'> {
  size?: AppInputSize;
}

export function AppTextArea({ className, resize = true, variant = 'filled', size = 'md', ...rest }: AppTextAreaProps): React.JSX.Element {
  return <LobeTextArea className={clsx(APP_INPUT_SIZE_CLASSES[size], className)} resize={resize} variant={variant} {...rest} />;
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
  size?: AppInputSize;
  mono?: boolean;
  style?: LobeSelectProps['style'];
  variant?: LobeSelectProps['variant'];
}

export function AppSelect({ value, onValueChange, options, placeholder, className, disabled = false, size = 'md', mono = false, style, variant = 'filled' }: AppSelectProps): React.JSX.Element {
  return (
    <LobeSelect
      className={clsx(APP_INPUT_SIZE_CLASSES[size], mono && 'font-mono tabular-nums', className)}
      disabled={disabled}
      options={options.map((option) => ({ label: option.label, value: option.value }))}
      placeholder={placeholder || '—'}
      size={size === 'sm' ? 'small' : size === 'lg' ? 'large' : 'middle'}
      style={style}
      value={value === '' ? undefined : value}
      variant={variant}
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

interface FilterPillProps {
  children: ReactNode;
  active?: boolean;
  className?: string;
  as?: 'div' | 'label';
  htmlFor?: string;
}

function filterPillClassName(active: boolean, className?: string): string {
  return clsx(
    'inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors',
    active ? 'border-sys-blue/40 bg-sys-blue/[0.04] text-txt-primary' : 'border-separator-thin bg-bg-elevated text-txt-secondary',
    className,
  );
}

export function FilterPill({ children, active = false, className, as = 'div', htmlFor }: FilterPillProps): React.JSX.Element {
  if (as === 'label') {
    return (
      <label htmlFor={htmlFor} className={filterPillClassName(active, className)}>
        {children}
      </label>
    );
  }

  return <div className={filterPillClassName(active, className)}>{children}</div>;
}

interface ToggleSwitchProps extends Omit<LobeSwitchProps, 'onChange'> {
  label?: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
}

export function ToggleSwitch({ checked, onCheckedChange, disabled = false, label, className, size = 'default', ...rest }: ToggleSwitchProps): React.JSX.Element {
  return (
    <label className={clsx('inline-flex items-center gap-2 text-[13px] font-medium text-txt-secondary', disabled && 'cursor-not-allowed opacity-40', className)}>
      <LobeSwitch
        checked={checked}
        disabled={disabled}
        size={size}
        onChange={(v: boolean) => onCheckedChange?.(v)}
        {...rest}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'default' | 'danger';
  leftIcon?: ReactNode;
  right?: ReactNode;
}

interface DropdownMenuItem {
  key: string;
  label: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  children: ReactNode;
}

export function DropdownMenu({ items, children }: DropdownMenuProps): React.JSX.Element {
  return (
    <LobeDropdown
      trigger={['click']}
      menu={{ items }}
    >
      {children}
    </LobeDropdown>
  );
}

export function MenuItem({ tone = 'default', leftIcon, right, children, type = 'button', className, role = 'menuitem', ...rest }: MenuItemProps): React.JSX.Element {
  return (
    <button
      type={type}
      role={role}
      className={clsx(
        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'danger' ? 'text-sys-red hover:bg-sys-red/10' : 'text-txt-secondary hover:bg-bg-raised hover:text-txt-primary',
        className,
      )}
      {...rest}
    >
      {leftIcon ? <span className="shrink-0" aria-hidden>{leftIcon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right ? <span className="shrink-0 text-txt-tertiary">{right}</span> : null}
    </button>
  );
}

interface SelectionBoxProps {
  selected: boolean;
  className?: string;
  label?: string;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
  disabled?: boolean;
}

function SelectionBoxMark(): React.JSX.Element {
  return <span className="h-2 w-2 rounded-sm bg-current" />;
}

export function SelectionBox({ selected, className, label, onClick, disabled = false }: SelectionBoxProps): React.JSX.Element {
  const boxClassName = clsx(
    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
    selected ? 'border-sys-blue bg-sys-blue text-white' : 'border-separator bg-bg-elevated text-transparent',
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={label}
        className={clsx('press disabled:cursor-not-allowed disabled:opacity-40', boxClassName)}
        disabled={disabled}
        onClick={onClick}
      >
        <SelectionBoxMark />
      </button>
    );
  }

  return (
    <span
      className={boxClassName}
      role={label ? 'checkbox' : undefined}
      aria-checked={label ? selected : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <SelectionBoxMark />
    </span>
  );
}

interface DisclosureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  variant?: 'flat' | 'card';
  className?: string;
}

const DISCLOSURE_VARIANT_CLASSES: Record<'flat' | 'card', string> = {
  flat: 'bg-transparent shadow-none',
  card: 'rounded-xl border border-separator-thin bg-bg-raised/60 px-3 py-2',
};

export function Disclosure({ open, onOpenChange, trigger, children, variant = 'flat', className }: DisclosureProps): React.JSX.Element {
  const expandedKeys: Key[] = open ? ['open'] : [];
  const handleExpandedChange: NonNullable<LobeAccordionProps['onExpandedChange']> = (keys) => {
    onOpenChange(keys.includes('open'));
  };

  return (
    <LobeAccordion
      accordion
      className={clsx(
        DISCLOSURE_VARIANT_CLASSES[variant],
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
      className={clsx('app-segmented-rect', className)}
      options={options.map((option) => ({ label: option.label, value: option.value }))}
      shape="default"
      value={value}
      variant="filled"
      onChange={(next) => onValueChange(String(next))}
    />
  );
}

export type AppTabsProps = LobeTabsProps;

export function Tabs(props: AppTabsProps): React.JSX.Element {
  return <LobeTabs {...props} />;
}

interface CopyButtonProps {
  content: string;
  className?: string;
}

export function CopyButton({ content, className }: CopyButtonProps): React.JSX.Element {
  return <LobeCopyButton className={className} content={content} />;
}

type ActionIconSize = 'small' | 'middle' | 'large';
type ActionIconVariant = 'borderless' | 'filled' | 'outlined';

interface ActionIconProps {
  icon: React.FC<any>;
  title: string;
  size?: ActionIconSize;
  variant?: ActionIconVariant;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

const ACTION_ICON_SIZE_MAP: Record<ActionIconSize, string> = {
  small: 'small',
  middle: 'middle',
  large: 'large',
};

export function ActionIcon({ icon: Icon, title, size = 'small', variant = 'borderless', disabled, loading, onClick, className }: ActionIconProps): React.JSX.Element {
  return (
    <LobeActionIcon
      className={className}
      disabled={disabled}
      icon={Icon}
      loading={loading}
      size={ACTION_ICON_SIZE_MAP[size] as 'small' | 'middle' | 'large'}
      title={title}
      variant={variant}
      onClick={onClick}
    />
  );
}

interface TooltipProps {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ title, children, className, placement = 'top' }: TooltipProps): React.JSX.Element {
  return (
    <LobeTooltip className={className} placement={placement} title={title}>
      {children}
    </LobeTooltip>
  );
}

interface CodeDiffProps {
  oldContent: string;
  newContent: string;
  language?: string;
  fileName?: string;
  showHeader?: boolean;
  viewMode?: 'split' | 'unified';
  className?: string;
}

export function CodeDiff({ oldContent, newContent, language, fileName, showHeader = true, viewMode = 'split', className }: CodeDiffProps): React.JSX.Element {
  return (
    <LobeCodeDiff
      className={className}
      fileName={fileName}
      language={language}
      newContent={newContent}
      oldContent={oldContent}
      showHeader={showHeader}
      viewMode={viewMode}
    />
  );
}

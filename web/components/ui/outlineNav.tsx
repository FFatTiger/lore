'use client';

import React, { type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';

interface OutlineNavShellProps {
  title?: ReactNode;
  ariaLabel?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function OutlineNavShell({
  title,
  ariaLabel,
  right,
  children,
  className,
}: OutlineNavShellProps): React.JSX.Element {
  return (
    <nav className={className} aria-label={ariaLabel}>
      <div>
        {(title || right) && (
          <div className="mb-6 flex items-center justify-between gap-2">
            {title && <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-txt-tertiary">{title}</div>}
            {right ? <div className="shrink-0">{right}</div> : null}
          </div>
        )}
        <div className="space-y-5">{children}</div>
      </div>
    </nav>
  );
}

interface OutlineNavFloatingPanelProps {
  title?: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  breakpoint?: 'md' | 'lg';
  left?: CSSProperties['left'];
  placeholderClassName?: string;
  panelClassName?: string;
  scrollerClassName?: string;
}

const FLOATING_BREAKPOINT_CLASSNAMES = {
  md: {
    placeholder: 'hidden md:block',
    panel: 'hidden md:flex',
  },
  lg: {
    placeholder: 'hidden lg:block',
    panel: 'hidden lg:flex',
  },
} as const;

export function OutlineNavFloatingPanel({
  title,
  ariaLabel,
  children,
  footer,
  breakpoint = 'lg',
  left,
  placeholderClassName,
  panelClassName,
  scrollerClassName,
}: OutlineNavFloatingPanelProps): React.JSX.Element {
  const breakpointClassNames = FLOATING_BREAKPOINT_CLASSNAMES[breakpoint];
  return (
    <>
      <div className={clsx(breakpointClassNames.placeholder, 'shrink-0', placeholderClassName)} aria-hidden />
      <aside
        style={left ? { left } : undefined}
        className={clsx(
          breakpointClassNames.panel,
          'fixed left-6 top-1/2 z-20 h-[620px] max-h-[calc(100vh-140px)] -translate-y-1/2 flex-col overflow-hidden p-4',
          panelClassName,
        )}
      >
        <div className={clsx('hover-scrollbar min-h-0 flex-1 overflow-y-auto pr-1', scrollerClassName)}>
          <OutlineNavShell ariaLabel={ariaLabel} title={title}>
            {children}
          </OutlineNavShell>
        </div>
        {footer ? <div className="mt-4 flex-shrink-0 border-t border-separator-hairline pt-3">{footer}</div> : null}
      </aside>
    </>
  );
}

interface OutlineNavGroupProps {
  label: ReactNode;
  children?: ReactNode;
  active?: boolean;
  left?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
}

export function OutlineNavGroup({
  label,
  children,
  active = false,
  left,
  right,
  onClick,
}: OutlineNavGroupProps): React.JSX.Element {
  const HeaderTag = onClick ? 'button' : 'div';
  return (
    <div>
      <HeaderTag
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        className={clsx(
          'mb-2 flex min-h-7 w-full items-center gap-2 rounded-lg py-1.5 text-left text-[13px] leading-snug transition-colors',
          onClick && 'cursor-pointer px-2 hover:bg-fill-quaternary',
          active ? 'bg-[color-mix(in_srgb,var(--sys-blue)_12%,transparent)] font-medium text-sys-blue' : 'text-txt-secondary',
        )}
      >
        {left ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{left}</span> : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {right ? <span className="shrink-0 text-[10px] text-txt-quaternary">{right}</span> : null}
      </HeaderTag>
      {children ? <div className="space-y-1 border-l border-separator-hairline pl-3">{children}</div> : null}
    </div>
  );
}

interface OutlineNavItemProps {
  children: ReactNode;
  active?: boolean;
  level?: number;
  left?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
}

export function OutlineNavItem({
  children,
  active = false,
  level = 0,
  left,
  right,
  onClick,
  title,
  className,
}: OutlineNavItemProps): React.JSX.Element {
  const style: CSSProperties | undefined = level > 0 ? { marginLeft: level * 10 } : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={style}
      className={clsx(
        'relative flex min-h-7 w-full items-center gap-2 rounded-lg py-1.5 pl-3 pr-2 text-left text-[13px] leading-snug transition-colors',
        active ? 'bg-[color-mix(in_srgb,var(--sys-blue)_12%,transparent)] font-medium text-sys-blue' : 'text-txt-secondary hover:bg-fill-quaternary hover:text-txt-primary',
        className,
      )}
    >
      {left ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{left}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right ? <span className="shrink-0 text-[10px] text-txt-quaternary">{right}</span> : null}
    </button>
  );
}

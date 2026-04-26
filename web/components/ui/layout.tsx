'use client';

import React, { type ReactNode } from 'react';
import clsx from 'clsx';
import { Card as LobeCard } from 'antd';

export type MaxWidth = '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full';

interface PageCanvasProps {
  children: ReactNode;
  maxWidth?: MaxWidth;
  className?: string;
  size?: MaxWidth;
}

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

export function Card({ children, className, padded = true, interactive = false }: CardProps): React.JSX.Element {
  return (
    <LobeCard
      className={clsx(
        'rounded-2xl border border-separator-thin bg-bg-elevated shadow-card',
        padded ? '[&_.ant-card-body]:p-4 [&_.ant-card-body]:md:p-5' : '[&_.ant-card-body]:p-0',
        interactive && 'transition-all duration-200 ease-spring hover:border-separator hover:bg-bg-raised',
        className,
      )}
    >
      {children}
    </LobeCard>
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

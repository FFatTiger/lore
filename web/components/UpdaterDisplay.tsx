'use client';

import React, { useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { AppAvatar, Tooltip } from './ui';
import { useT } from '../lib/i18n';
import {
  clientTypeAssetPath,
  clientTypeInitials,
  clientTypeLabel,
  clientTypeTone,
  type ClientTone,
} from './clientTypeMeta';

export interface UpdaterSummary {
  client_type?: string | null;
  source?: string | null;
  updated_at?: string | null;
  event_count?: number | null;
}

interface ResolvedUpdater {
  client_type: string | null;
  source: string | null;
  updated_at: string | null;
  event_count: number;
}

interface UpdaterDisplayProps {
  updaters?: UpdaterSummary[] | null;
  fallbackClientType?: string | null;
  fallbackSource?: string | null;
  fallbackUpdatedAt?: string | null;
  size?: 'sm' | 'md';
  showTimestamp?: boolean;
  className?: string;
  onOpenHistory?: () => void;
}

const AVATAR_SURFACE = 'bg-bg-elevated';

const AVATAR_TEXT: Record<ClientTone, string> = {
  blue: 'text-sys-blue',
  purple: 'text-sys-purple',
  teal: 'text-sys-teal',
  orange: 'text-sys-orange',
  soft: 'text-txt-tertiary',
};

const MAX_VISIBLE_UPDATERS = 2;

const SIZE_MAP = {
  sm: {
    avatar: 20,
    popupAvatar: 28,
    fontSize: 10,
    stackPrimary: 20,
    stackSecondary: 14,
    stackWidth: 26,
    stackHeight: 20,
    stackOffsetX: 12,
    stackOffsetY: 6,
    overflow: 18,
  },
  md: {
    avatar: 24,
    popupAvatar: 30,
    fontSize: 11,
    stackPrimary: 24,
    stackSecondary: 16,
    stackWidth: 31,
    stackHeight: 24,
    stackOffsetX: 15,
    stackOffsetY: 8,
    overflow: 22,
  },
} as const;

function normalizeUpdater(updater?: UpdaterSummary | null): ResolvedUpdater | null {
  if (!updater) return null;
  const clientType = typeof updater.client_type === 'string' && updater.client_type.trim()
    ? updater.client_type.trim()
    : null;
  const source = typeof updater.source === 'string' && updater.source.trim()
    ? updater.source.trim()
    : null;
  const updatedAt = typeof updater.updated_at === 'string' && updater.updated_at.trim()
    ? updater.updated_at.trim()
    : null;
  const eventCount = Number.isFinite(Number(updater.event_count))
    ? Math.max(1, Number(updater.event_count))
    : 1;
  if (!clientType && !source && !updatedAt) return null;
  return {
    client_type: clientType,
    source,
    updated_at: updatedAt,
    event_count: eventCount,
  };
}

function sortUpdaters(updaters: ResolvedUpdater[]): ResolvedUpdater[] {
  return [...updaters].sort((left, right) => {
    const leftTime = left.updated_at || '';
    const rightTime = right.updated_at || '';
    return rightTime.localeCompare(leftTime);
  });
}

function resolveUpdaters({
  updaters,
  fallbackClientType,
  fallbackSource,
  fallbackUpdatedAt,
}: Omit<UpdaterDisplayProps, 'size' | 'showTimestamp' | 'className'>): ResolvedUpdater[] {
  const normalized = sortUpdaters((updaters || []).map(normalizeUpdater).filter(Boolean) as ResolvedUpdater[]);
  if (normalized.length > 0) return normalized;
  const fallback = normalizeUpdater({
    client_type: fallbackClientType,
    source: fallbackSource,
    updated_at: fallbackUpdatedAt,
    event_count: 1,
  });
  return fallback ? [fallback] : [];
}

function formatUpdatedAt(updatedAt: string | null, t: (key: string) => string): string {
  if (!updatedAt) return t('Unknown time');
  return new Date(updatedAt).toLocaleString();
}

export function ChannelAvatar({
  clientType,
  size,
  elevated = false,
}: {
  clientType?: string | null;
  size: number;
  elevated?: boolean;
}): React.JSX.Element {
  const { t } = useT();
  const normalizedClientType = typeof clientType === 'string' ? clientType.trim().toLowerCase() : '';
  const tone = clientTypeTone(clientType);
  const label = t(clientTypeLabel(clientType));
  const src = clientTypeAssetPath(clientType);
  const initials = clientTypeInitials(clientType);
  const isHermes = normalizedClientType === 'hermes';

  return (
    <AppAvatar
      alt={label}
      aria-label={label}
      avatar={isHermes ? (
        <span
          aria-hidden="true"
          className="block h-[72%] w-[72%] shrink-0 bg-current select-none"
          style={{
            WebkitMaskImage: 'url(/channel-icons/hermes.svg)',
            maskImage: 'url(/channel-icons/hermes.svg)',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
          }}
        />
      ) : src || initials}
      className={clsx(
        'shrink-0 overflow-hidden border-separator-thin',
        AVATAR_SURFACE,
        AVATAR_TEXT[tone],
      )}
      size={size}
      style={{
        boxShadow: elevated ? '0 0 0 2px var(--bg-elevated)' : '0 0 0 1px rgba(255,255,255,0.08)',
        fontSize: Math.max(10, Math.floor(size * 0.38)),
      }}
      title={label}
      variant="outlined"
    />
  );
}

export default function UpdaterDisplay({
  updaters,
  fallbackClientType = null,
  fallbackSource = null,
  fallbackUpdatedAt = null,
  size = 'sm',
  showTimestamp = false,
  className,
  onOpenHistory,
}: UpdaterDisplayProps): React.JSX.Element | null {
  const { t } = useT();
  const resolvedUpdaters = useMemo(() => resolveUpdaters({
    updaters,
    fallbackClientType,
    fallbackSource,
    fallbackUpdatedAt,
  }), [fallbackClientType, fallbackSource, fallbackUpdatedAt, updaters]);

  if (resolvedUpdaters.length === 0) return null;

  const {
    avatar,
    fontSize,
    stackPrimary,
    stackSecondary,
    stackWidth,
    stackHeight,
    stackOffsetX,
    stackOffsetY,
    overflow,
  } = SIZE_MAP[size];
  const visibleUpdaters = resolvedUpdaters.slice(0, MAX_VISIBLE_UPDATERS);
  const overflowCount = Math.max(0, resolvedUpdaters.length - visibleUpdaters.length);
  const latestUpdater = resolvedUpdaters[0];
  const showStack = visibleUpdaters.length > 1;
  const canOpenHistory = Boolean(onOpenHistory);

  const openHistory = useCallback((event: React.MouseEvent | React.KeyboardEvent) => {
    if (!onOpenHistory) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenHistory();
  }, [onOpenHistory]);

  const trigger = (
    <span
      className={clsx('relative inline-flex items-center gap-2', canOpenHistory && 'cursor-pointer', className)}
      onClick={canOpenHistory ? openHistory : undefined}
      onKeyDown={canOpenHistory ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') openHistory(event);
      } : undefined}
      role={canOpenHistory ? 'button' : undefined}
      tabIndex={canOpenHistory ? 0 : undefined}
    >
      <span className="inline-flex cursor-pointer items-center">
            {showStack ? (
              <span className="relative inline-block shrink-0" style={{ width: stackWidth, height: stackHeight }}>
                <span className="absolute left-0 top-0 z-10">
                  <ChannelAvatar clientType={visibleUpdaters[0].client_type} size={stackPrimary} elevated />
                </span>
                <span className="absolute z-20" style={{ left: stackOffsetX, top: stackOffsetY }}>
                  <ChannelAvatar clientType={visibleUpdaters[1].client_type} size={stackSecondary} elevated />
                </span>
              </span>
            ) : (
              <ChannelAvatar clientType={latestUpdater.client_type} size={avatar} elevated />
            )}
            {overflowCount > 0 && (
              <span
                className="ml-1 inline-flex shrink-0 items-center justify-center rounded-full border border-separator-thin bg-bg-elevated font-medium text-txt-secondary shadow-sm"
                style={{ minWidth: overflow, height: overflow, fontSize }}
              >
                +{overflowCount}
              </span>
            )}
      </span>
      {showTimestamp && latestUpdater.updated_at && (
        <span className="text-[11px] text-txt-quaternary">
          {formatUpdatedAt(latestUpdater.updated_at, t)}
        </span>
      )}
    </span>
  );

  return canOpenHistory ? <Tooltip title={t('View history changes')}>{trigger}</Tooltip> : trigger;
}

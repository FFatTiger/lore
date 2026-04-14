'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Badge } from './ui';
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
}

interface UpdaterPopupPosition {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
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

function formatUpdatedAt(updatedAt: string | null): string {
  if (!updatedAt) return 'Unknown time';
  return new Date(updatedAt).toLocaleString();
}

function formatEventCount(eventCount: number): string {
  return eventCount === 1 ? '1 update' : `${eventCount} updates`;
}

function stopEvent(event: React.MouseEvent<HTMLElement>): void {
  event.preventDefault();
  event.stopPropagation();
}

function clampPopupLeft(anchorLeft: number, width: number): number {
  if (typeof window === 'undefined') return anchorLeft;
  return Math.max(16, Math.min(anchorLeft, window.innerWidth - width - 16));
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
  const normalizedClientType = typeof clientType === 'string' ? clientType.trim().toLowerCase() : '';
  const tone = clientTypeTone(clientType);
  const label = clientTypeLabel(clientType);
  const src = clientTypeAssetPath(clientType);
  const initials = clientTypeInitials(clientType);
  const isHermes = normalizedClientType === 'hermes';

  return (
    <span
      className={clsx(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-separator-thin shadow-sm',
        AVATAR_SURFACE,
        AVATAR_TEXT[tone],
      )}
      style={{
        width: size,
        height: size,
        boxShadow: elevated ? '0 0 0 2px var(--bg-elevated)' : '0 0 0 1px rgba(255,255,255,0.08)',
      }}
      aria-label={label}
      title={label}
    >
      {src ? (
        isHermes ? (
          <span className="relative flex h-[72%] w-[72%] items-center justify-center">
            <img
              src={src}
              alt=""
              aria-hidden="true"
              className="theme-dark-asset h-full w-full object-contain select-none"
              draggable={false}
            />
            <img
              src="/channel-icons/hermes-light.svg"
              alt=""
              aria-hidden="true"
              className="theme-light-asset absolute inset-0 h-full w-full object-contain select-none"
              draggable={false}
            />
          </span>
        ) : (
          <img
            src={src}
            alt={label}
            className="h-[72%] w-[72%] object-contain select-none"
            draggable={false}
          />
        )
      ) : (
        <span className="font-semibold" style={{ fontSize: Math.max(10, Math.floor(size * 0.38)) }}>
          {initials}
        </span>
      )}
    </span>
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
}: UpdaterDisplayProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState<UpdaterPopupPosition | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const resolvedUpdaters = useMemo(() => resolveUpdaters({
    updaters,
    fallbackClientType,
    fallbackSource,
    fallbackUpdatedAt,
  }), [fallbackClientType, fallbackSource, fallbackUpdatedAt, updaters]);

  const updatePopupPosition = useCallback(() => {
    if (!wrapperRef.current || typeof window === 'undefined') return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const popupWidth = 288;
    const left = clampPopupLeft(rect.left, popupWidth);
    const estimatedHeight = 280;
    const shouldOpenAbove = rect.bottom + estimatedHeight > window.innerHeight - 16 && rect.top > estimatedHeight + 16;
    setPopupPosition(shouldOpenAbove
      ? {
        left,
        bottom: window.innerHeight - rect.top + 8,
        maxHeight: Math.max(120, rect.top - 24),
      }
      : {
        left,
        top: rect.bottom + 8,
        maxHeight: Math.max(120, window.innerHeight - rect.bottom - 24),
      });
  }, []);

  useEffect(() => {
    if (!open) {
      setPopupPosition(null);
      return undefined;
    }
    updatePopupPosition();
    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleViewportChange = () => updatePopupPosition();
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updatePopupPosition]);

  if (resolvedUpdaters.length === 0) return null;

  const {
    avatar,
    popupAvatar,
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

  return (
    <span
      ref={wrapperRef}
      className={clsx('relative inline-flex items-center gap-2', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        className="inline-flex cursor-pointer items-center"
        onClick={(event) => {
          stopEvent(event);
          setOpen((value) => !value);
        }}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((value) => !value);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
      >
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
          {formatUpdatedAt(latestUpdater.updated_at)}
        </span>
      )}
      {open && popupPosition && createPortal(
        <div
          className="animate-scale fixed z-[110] w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-separator-thin bg-bg-elevated shadow-card shadow-2xl shadow-black/60 backdrop-blur-xl"
          style={popupPosition}
          onClick={stopEvent}
          onMouseDown={stopEvent}
        >
          <div className="flex items-center gap-2 border-b border-separator-thin px-4 py-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">
              {resolvedUpdaters.length > 1 ? 'Updaters' : 'Updater'}
            </span>
            <span className="text-[12px] text-txt-tertiary">
              {formatUpdatedAt(latestUpdater.updated_at)}
            </span>
          </div>
          <div className="p-1.5">
            {resolvedUpdaters.map((updater, index) => (
              <div
                key={`${updater.client_type || 'legacy'}:${updater.source || 'unknown'}:${updater.updated_at || index}`}
                className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-fill-quaternary"
              >
                <ChannelAvatar clientType={updater.client_type} size={popupAvatar} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-txt-primary">
                      {clientTypeLabel(updater.client_type)}
                    </span>
                    <Badge tone={clientTypeTone(updater.client_type)}>{formatEventCount(updater.event_count)}</Badge>
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-txt-tertiary">
                    {updater.source || 'Unknown source'}
                  </div>
                  <div className="mt-1 text-[11px] text-txt-quaternary">
                    {formatUpdatedAt(updater.updated_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

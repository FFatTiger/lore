'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { OutlineNavGroup, OutlineNavItem, OutlineNavShell } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { localizedLabel, type SectionGroup } from './SettingsSectionEditor';

export const BACKUP_ACTIONS_SECTION_ID = 'backup-actions';
export const ABOUT_SECTION_ID = 'about';

export function settingsSectionAnchor(sectionId: string): string {
  return `settings-section-${sectionId}`;
}

export interface SettingsOutlineEntry {
  id: string;
  label: string;
  dirtyCount: number;
}

export interface SettingsOutlineGroup {
  id: string;
  label: string;
  entries: SettingsOutlineEntry[];
}

const OUTLINE_GROUPS: Array<{ id: string; label: string; sections: string[] }> = [
  { id: 'general', label: 'General', sections: ['cache', 'lifecycle', 'prompts'] },
  {
    id: 'recall',
    label: 'Recall',
    sections: ['recall_weights', 'recall_bonus', 'recall_recency', 'recall_display', 'recall_safety', 'views'],
  },
  { id: 'models', label: 'Model services', sections: ['embedding', 'view_llm'] },
  {
    id: 'maintenance',
    label: 'Maintenance',
    sections: ['policy', 'dream', 'backup', BACKUP_ACTIONS_SECTION_ID, 'review', ABOUT_SECTION_ID],
  },
];

/**
 * Group settings sections for the page outline. `pagePanels` are page-only
 * panels (backup actions, about) that aren't part of the server schema.
 * Sections the server adds later land in an "Other" group so they stay reachable.
 */
export function buildSettingsOutline(
  sections: SectionGroup[],
  draft: Record<string, unknown>,
  pagePanels: Array<{ id: string; label: string }>,
  lang: 'zh' | 'en' = 'zh',
): SettingsOutlineGroup[] {
  const entries = new Map<string, SettingsOutlineEntry>();
  for (const section of sections) {
    entries.set(section.id, {
      id: section.id,
      label: localizedLabel(section, lang),
      dirtyCount: section.items.filter((item) => item.key in draft).length,
    });
  }
  for (const panel of pagePanels) entries.set(panel.id, { ...panel, dirtyCount: 0 });

  const groups: SettingsOutlineGroup[] = [];
  const placed = new Set<string>();
  for (const group of OUTLINE_GROUPS) {
    const groupEntries = group.sections.flatMap((id) => {
      const entry = entries.get(id);
      if (!entry) return [];
      placed.add(id);
      return [entry];
    });
    if (groupEntries.length) groups.push({ id: group.id, label: group.label, entries: groupEntries });
  }
  const rest = [...entries.values()].filter((entry) => !placed.has(entry.id));
  if (rest.length) groups.push({ id: 'other', label: 'Other', entries: rest });
  return groups;
}

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/** Scroll distance (px) after which the back-to-top button appears. */
const BACK_TO_TOP_THRESHOLD = 480;

/** Tracks which section is under the top of the page's scroll container. */
export function useSettingsScrollSpy(sectionIds: string[]): {
  activeId: string | null;
  scrollTo: (sectionId: string) => void;
  scrolledDown: boolean;
  scrollToTop: () => void;
} {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [scrolledDown, setScrolledDown] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);
  const idsKey = sectionIds.join('|');

  useEffect(() => {
    if (!sectionIds.length) return undefined;
    const first = document.getElementById(settingsSectionAnchor(sectionIds[0]));
    const container = findScrollParent(first);
    if (!container) return undefined;
    containerRef.current = container;

    const update = (): void => {
      setScrolledDown(container.scrollTop > BACK_TO_TOP_THRESHOLD);
      const top = container.getBoundingClientRect().top + 96;
      let current = sectionIds[0];
      for (const id of sectionIds) {
        const el = document.getElementById(settingsSectionAnchor(id));
        if (el && el.getBoundingClientRect().top <= top) current = id;
      }
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
      setActiveId(atBottom ? sectionIds[sectionIds.length - 1] : current);
    };

    const hash = window.location.hash.replace(/^#/, '');
    if (hash.startsWith('settings-section-')) {
      document.getElementById(hash)?.scrollIntoView({ block: 'start' });
    }
    update();
    container.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      container.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
    // sectionIds is tracked through idsKey so a new array identity doesn't rebind listeners.
  }, [idsKey]);

  const scrollTo = useCallback((sectionId: string) => {
    const anchor = settingsSectionAnchor(sectionId);
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.replaceState(null, '', `#${anchor}`);
    setActiveId(sectionId);
  }, []);

  const scrollToTop = useCallback(() => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  return { activeId, scrollTo, scrolledDown, scrollToTop };
}

interface SettingsOutlineProps {
  groups: SettingsOutlineGroup[];
  activeId: string | null;
  onSelect: (sectionId: string) => void;
}

function DirtyBadge({ count }: { count: number }): React.JSX.Element | null {
  if (!count) return null;
  return (
    <span className="rounded-full bg-sys-orange/15 px-1.5 text-[10px] font-medium tabular-nums text-sys-orange">
      {count}
    </span>
  );
}

/**
 * Sidebar outline for wide screens. It scrolls on its own when taller than the
 * viewport (without dragging the page along), fades the clipped edges, and keeps
 * the active entry in view.
 */
export function SettingsOutlineSidebar({ groups, activeId, onSelect }: SettingsOutlineProps): React.JSX.Element {
  const { t } = useT();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });

  const updateFade = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setFade({
      top: el.scrollTop > 1,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    updateFade();
    el.addEventListener('scroll', updateFade, { passive: true });
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', updateFade);
      observer.disconnect();
    };
  }, [updateFade]);

  // Scroll only the sidebar (never the page) so the active entry stays visible.
  // Instant on purpose: Chrome interrupts a smooth scroll here while the page
  // container above it is itself smooth-scrolling (nav clicks, back to top).
  const entryIds = groups.flatMap((group) => group.entries.map((entry) => entry.id));
  const activeIndex = activeId ? entryIds.indexOf(activeId) : -1;
  useEffect(() => {
    const el = scrollerRef.current;
    // Group headings aren't buttons, so entries map 1:1 onto the buttons in order.
    const item = el && activeIndex >= 0 ? el.querySelectorAll<HTMLElement>('button')[activeIndex] : null;
    if (!el || !item) return;
    if (activeIndex === 0) {
      el.scrollTop = 0;
      return;
    }
    const margin = 32;
    const top = item.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    const bottom = top + item.offsetHeight;
    if (top < el.scrollTop + margin) {
      const target = top - margin;
      el.scrollTop = target < margin ? 0 : target;
    } else if (bottom > el.scrollTop + el.clientHeight - margin) {
      el.scrollTop = bottom - el.clientHeight + margin;
    }
  }, [activeIndex]);

  return (
    <div
      ref={scrollerRef}
      className="quiet-scroll max-h-[calc(100vh-8rem)] overflow-y-auto py-1 pr-2"
      data-fade-top={fade.top}
      data-fade-bottom={fade.bottom}
    >
      <OutlineNavShell ariaLabel={t('Settings sections')}>
        {groups.map((group) => (
          <OutlineNavGroup key={group.id} label={t(group.label)}>
            {group.entries.map((entry) => (
              <OutlineNavItem
                key={entry.id}
                active={entry.id === activeId}
                onClick={() => onSelect(entry.id)}
                title={entry.label}
                right={<DirtyBadge count={entry.dirtyCount} />}
              >
                {entry.label}
              </OutlineNavItem>
            ))}
          </OutlineNavGroup>
        ))}
      </OutlineNavShell>
    </div>
  );
}

/** Horizontally scrolling section chips for narrow screens. */
export function SettingsOutlineChips({ groups, activeId, onSelect }: SettingsOutlineProps): React.JSX.Element {
  const { t } = useT();
  const navRef = useRef<HTMLElement>(null);

  // Keep the active chip visible without moving the page vertically.
  useEffect(() => {
    const nav = navRef.current;
    const chip = activeId ? nav?.querySelector<HTMLElement>(`[data-section="${activeId}"]`) : null;
    if (!nav || !chip) return;
    const left = chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [activeId]);

  return (
    <nav
      ref={navRef}
      aria-label={t('Settings sections')}
      className="no-scrollbar relative -mx-4 flex gap-1.5 overflow-x-auto px-4 py-2"
    >
      {groups.flatMap((group) => group.entries).map((entry) => (
        <button
          key={entry.id}
          type="button"
          data-section={entry.id}
          onClick={() => onSelect(entry.id)}
          className={clsx(
            'flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12.5px] transition-colors',
            entry.id === activeId
              ? 'bg-sys-blue/[0.12] font-medium text-sys-blue'
              : 'bg-fill-quaternary text-txt-secondary hover:text-txt-primary',
          )}
        >
          {entry.label}
          <DirtyBadge count={entry.dirtyCount} />
        </button>
      ))}
    </nav>
  );
}

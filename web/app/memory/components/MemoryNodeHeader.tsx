import React, { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Button, PageTitle } from '../../../components/ui';
import { MoreHorizontal, PanelLeftOpen } from 'lucide-react';
import PriorityBadge from './PriorityBadge';
import type { BrowseData, MemoryNode } from '../useMemoryBrowserController';

interface MemoryNodeHeaderProps {
  node: MemoryNode;
  data: BrowseData;
  domain: string;
  path: string;
  isRoot: boolean;
  editing: boolean;
  moving: boolean;
  creating: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
  startEditing: () => void;
  setCreating: (value: boolean) => void;
  setMoving: (value: boolean) => void;
  handleRebuildViews: () => Promise<void>;
  rebuildingViews: boolean;
  handleDelete: () => Promise<void>;
  navigateTo: (newPath: string, newDomain?: string) => void;
  t: (key: string) => string;
}

export default function MemoryNodeHeader({
  node,
  data,
  domain,
  path,
  isRoot,
  editing,
  moving,
  creating,
  sidebarOpen,
  setSidebarOpen,
  startEditing,
  setCreating,
  setMoving,
  handleRebuildViews,
  rebuildingViews,
  handleDelete,
  navigateTo,
  t,
}: MemoryNodeHeaderProps): React.JSX.Element {
  const [actionsOpen, setActionsOpen] = useState(false);
  const headerBreadcrumbs = data.breadcrumbs || [];
  const titleText = path ? path.split('/').pop() || t('root') : t('root');

  return (
    <PageTitle
      eyebrow={
        <nav className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => navigateTo('', domain)}
            className="text-sys-blue hover:opacity-80 transition-opacity"
          >
            {t('Memory')}
          </button>
          {headerBreadcrumbs.slice(1, -1).map((crumb) => (
            <React.Fragment key={crumb.path || 'root'}>
              <span className="text-txt-quaternary">/</span>
              <button
                onClick={() => navigateTo(crumb.path || '')}
                className="max-w-[12rem] truncate text-sys-blue/70 transition-colors hover:text-sys-blue"
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </nav>
      }
      title={
        <span className="inline-flex max-w-full items-start gap-3 align-top">
          <span className="block min-w-0 truncate">{titleText}</span>
          {!editing && node.priority != null && (
            <span className="mt-1 shrink-0"><PriorityBadge priority={node.priority} size="lg" /></span>
          )}
        </span>
      }
      titleText={titleText}
      truncateTitle={false}
      compact
      right={
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!sidebarOpen && (
            <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(true)}>
              <PanelLeftOpen size={14} /> {t('Tree')}
            </Button>
          )}
          {!editing && !moving && !creating && !node.is_virtual && (
            <>
              <Button variant="ghost" size="sm" onClick={startEditing}>
                {t('Edit')}
              </Button>
              <Popover.Root open={actionsOpen} onOpenChange={setActionsOpen}>
                <Popover.Trigger asChild>
                  <Button variant="ghost" size="sm" aria-label={t('More')}>
                    <MoreHorizontal size={15} />
                  </Button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    align="end"
                    sideOffset={8}
                    className="z-50 min-w-36 rounded-xl border border-separator-thin bg-bg-elevated p-1.5 shadow-dock"
                  >
                    <button
                      type="button"
                      onClick={() => { setActionsOpen(false); setCreating(true); }}
                      className="flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] text-txt-secondary hover:bg-bg-raised hover:text-txt-primary"
                    >
                      {t('New')}
                    </button>
                    {!isRoot && (
                      <button
                        type="button"
                        onClick={() => { setActionsOpen(false); setMoving(true); }}
                        className="flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] text-txt-secondary hover:bg-bg-raised hover:text-txt-primary"
                      >
                        {t('Move')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setActionsOpen(false); void handleRebuildViews(); }}
                      disabled={rebuildingViews}
                      className="flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] text-txt-secondary hover:bg-bg-raised hover:text-txt-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {rebuildingViews ? t('Rebuilding…') : t('Rebuild')}
                    </button>
                    {!isRoot && (
                      <button
                        type="button"
                        onClick={() => { setActionsOpen(false); void handleDelete(); }}
                        className="flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] text-sys-red hover:bg-sys-red/10"
                      >
                        {t('Delete')}
                      </button>
                    )}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </>
          )}
        </div>
      }
    />
  );
}

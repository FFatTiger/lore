import React from 'react';
import { Button, PageTitle } from '../../../components/ui';
import { PanelLeftOpen } from 'lucide-react';
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
  navigateToHistory: () => void;
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
  navigateToHistory,
  t,
}: MemoryNodeHeaderProps): React.JSX.Element {
  const headerBreadcrumbs = data.breadcrumbs || [];
  const fallbackDescription = node.disclosure
    ? null
    : isRoot
      ? t('Agent memory graph')
      : data.children?.length > 0
        ? `${data.children.length} ${t(isRoot ? 'Clusters' : 'Children')}`
        : null;

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
      truncateTitle
      description={!node.disclosure ? fallbackDescription : undefined}
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
              <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
                {t('New')}
              </Button>
              {!isRoot && (
                <Button variant="ghost" size="sm" onClick={navigateToHistory}>
                  {t('History')}
                </Button>
              )}
              {!isRoot && (
                <Button variant="ghost" size="sm" onClick={() => setMoving(true)}>
                  {t('Move')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => void handleRebuildViews()} disabled={rebuildingViews}>
                {rebuildingViews ? t('Rebuilding…') : t('Rebuild')}
              </Button>
              {!isRoot && (
                <Button variant="destructive" size="sm" onClick={() => void handleDelete()}>
                  {t('Delete')}
                </Button>
              )}
            </>
          )}
        </div>
      }
    />
  );
}

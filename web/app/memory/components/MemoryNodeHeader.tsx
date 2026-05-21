import React from 'react';
import { Button, DropdownMenu } from '../../../components/ui';
import { Clock3, MoreHorizontal, PanelLeftOpen, Pencil } from 'lucide-react';
import UpdaterDisplay, { type UpdaterSummary } from '../../../components/UpdaterDisplay';
import PriorityBadge from './PriorityBadge';
import KeywordManager from './KeywordManager';
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
  refreshData: () => Promise<void>;
  navigateToHistory: () => void;
  t: (key: string) => string;
}

function formatTime(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : '';
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
  refreshData,
  navigateToHistory,
  t,
}: MemoryNodeHeaderProps): React.JSX.Element {
  const headerBreadcrumbs = data.breadcrumbs || [];
  const titleText = path ? path.split('/').pop() || domain : domain;
  const timestamp = node.last_updated_at || node.created_at || null;
  const timestampLabel = node.last_updated_at ? t('Updated') : t('Created');
  const hasSource = Boolean(node.last_updated_at);
  const canShowKeywords = !node.is_virtual && Boolean(path);
  const showSubtitle = !editing && Boolean(timestamp || hasSource || canShowKeywords);

  return (
    <div className="mb-7 space-y-3" data-memory-node-header="true">
      <nav className="flex items-center gap-1.5 text-[13px] font-medium text-sys-blue">
        <button type="button" onClick={() => navigateTo('', domain)} className="press hover:opacity-80">
          {t('Memory')}
        </button>
        {headerBreadcrumbs.slice(1, -1).map((crumb) => (
          <React.Fragment key={crumb.path || 'root'}>
            <span className="text-txt-quaternary">/</span>
            <button type="button" onClick={() => navigateTo(crumb.path || '')} className="press max-w-[12rem] truncate hover:opacity-80">
              {crumb.label}
            </button>
          </React.Fragment>
        ))}
      </nav>

      <div className="flex items-center justify-between gap-4" data-memory-title-row="true">
        <div className="min-w-0">
          <h1 className="flex min-w-0 items-center gap-3 font-display text-[34px] font-semibold leading-none tracking-[-0.02em] text-txt-primary md:text-[42px]">
            <span className="min-w-0 truncate">{titleText}</span>
            {!editing && node.priority != null && (
              <span className="shrink-0"><PriorityBadge priority={node.priority} size="lg" /></span>
            )}
          </h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!sidebarOpen && (
            <Button onClick={() => setSidebarOpen(true)} className="md:hidden">
              <PanelLeftOpen size={14} /> {t('Tree')}
            </Button>
          )}
          {!editing && !moving && !creating && !node.is_virtual && (
            <>
              <Button onClick={startEditing}>
                <Pencil size={15} /> {t('Edit')}
              </Button>
              <DropdownMenu
                items={[
                  { key: 'new', label: t('New'), onClick: () => setCreating(true) },
                  ...(!isRoot ? [{ key: 'move', label: t('Move'), onClick: () => setMoving(true) }] : []),
                  { key: 'rebuild', label: rebuildingViews ? t('Rebuilding…') : t('Rebuild'), disabled: rebuildingViews, onClick: () => void handleRebuildViews() },
                  ...(!isRoot ? [{ key: 'delete', label: t('Delete'), danger: true, onClick: () => void handleDelete() }] : []),
                ]}
              >
                <Button aria-label={t('More')}>
                  <MoreHorizontal size={15} />
                </Button>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {showSubtitle && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-txt-tertiary" data-memory-node-subtitle="true">
          {timestamp && (
            <span className="inline-flex items-center gap-1.5" title={formatTime(timestamp)}>
              <Clock3 size={13} />
              <span>{timestampLabel}: {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </span>
          )}
          {hasSource && (
            <span className="inline-flex items-center gap-1.5">
              <span>{t('Source')}:</span>
              <UpdaterDisplay
                updaters={node.updaters as UpdaterSummary[] | undefined}
                fallbackClientType={node.last_updated_client_type}
                fallbackSource={node.last_updated_source}
                fallbackUpdatedAt={node.last_updated_at}
                size="sm"
                onOpenHistory={navigateToHistory}
              />
            </span>
          )}
          {canShowKeywords && (
            <KeywordManager
              keywords={node.glossary_keywords || []}
              domain={domain}
              path={path}
              onUpdate={() => void refreshData()}
              variant="subtitle"
            />
          )}
        </div>
      )}
    </div>
  );
}

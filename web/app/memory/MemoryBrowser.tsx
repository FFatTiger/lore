'use client';

import React from 'react';
import { Button } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { useConfirm } from '../../components/ConfirmDialog';
import MemoryChildrenList from './components/MemoryChildrenList';
import MemoryBrowserSidebar from './components/MemoryBrowserSidebar';
import MemoryNodeHeader from './components/MemoryNodeHeader';
import MemoryNodeMeta from './components/MemoryNodeMeta';
import MemoryBrowserPanels from './components/MemoryBrowserPanels';
import {
  useMemoryBrowserController,
  type ChildItem,
} from './useMemoryBrowserController';

interface SkeletonLineProps {
  w?: string;
}

function SkeletonLine({ w = '100%' }: SkeletonLineProps): React.JSX.Element {
  return <div className="h-3 rounded-md skeleton" style={{ width: w }} />;
}

export default function MemoryBrowser(): React.JSX.Element {
  const { t } = useT();
  const { confirm, toast } = useConfirm();
  const {
    domain,
    path,
    data,
    domains,
    node,
    isRoot,
    loading,
    error,
    sidebarOpen,
    editing,
    editContent,
    editDisclosure,
    editPriority,
    saving,
    moving,
    creating,
    rebuildingViews,
    setSidebarOpen,
    setEditContent,
    setEditDisclosure,
    setEditPriority,
    setMoving,
    setCreating,
    navigateTo,
    refreshData,
    startEditing,
    cancelEditing,
    handleSave,
    handleDelete,
    handleRebuildViews,
  } = useMemoryBrowserController({ confirmDialog: confirm, t, toast });
  const hasEmptyState = !data.children?.length && !node?.content && !node?.memory_views?.length;

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-4 py-4 md:px-6 md:py-8">
        <div className="flex gap-5 md:gap-10">
          <MemoryBrowserSidebar
            domains={domains}
            domain={domain}
            path={path}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            navigateTo={navigateTo}
            t={t}
          />

          <main className="min-w-0 flex-1">
            {loading ? (
              <div className="animate-in space-y-5">
                <SkeletonLine w="50%" />
                <SkeletonLine w="30%" />
                <div className="h-40 rounded-2xl skeleton" />
                <div className="space-y-3">
                  <SkeletonLine />
                  <SkeletonLine w="90%" />
                  <SkeletonLine w="75%" />
                </div>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
                <p className="text-[16px] text-sys-red">{error}</p>
                <Button variant="secondary" onClick={() => navigateTo('', domain)}>{t('Return to root')}</Button>
              </div>
            ) : (
              <>
                {node && (
                  <>
                    <MemoryNodeHeader
                      node={node}
                      data={data}
                      domain={domain}
                      path={path}
                      isRoot={isRoot}
                      editing={editing}
                      moving={moving}
                      creating={creating}
                      sidebarOpen={sidebarOpen}
                      setSidebarOpen={setSidebarOpen}
                      startEditing={startEditing}
                      setCreating={setCreating}
                      setMoving={setMoving}
                      handleRebuildViews={handleRebuildViews}
                      rebuildingViews={rebuildingViews}
                      handleDelete={handleDelete}
                      navigateTo={navigateTo}
                      t={t}
                    />
                    <MemoryNodeMeta
                      node={node}
                      editing={editing}
                      refreshData={refreshData}
                      navigateTo={navigateTo}
                      t={t}
                    />
                  </>
                )}

                <MemoryBrowserPanels
                  editing={editing}
                  moving={moving}
                  creating={creating}
                  editContent={editContent}
                  setEditContent={setEditContent}
                  editDisclosure={editDisclosure}
                  setEditDisclosure={setEditDisclosure}
                  editPriority={editPriority}
                  setEditPriority={setEditPriority}
                  saving={saving}
                  cancelEditing={cancelEditing}
                  handleSave={handleSave}
                  domain={domain}
                  path={path}
                  navigateTo={navigateTo}
                  refreshData={refreshData}
                  setMoving={setMoving}
                  setCreating={setCreating}
                />

                <div className="space-y-6">
                  <MemoryChildrenList childItems={data.children as ChildItem[]} domain={domain} isRoot={isRoot} navigateTo={navigateTo} />

                  {hasEmptyState && (
                    <div className="py-16 text-center">
                      <p className="text-[15px] text-txt-tertiary">{t('This folder is empty.')}</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

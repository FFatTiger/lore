import React from 'react';
import { Badge, Notice } from '../../../components/ui';
import UpdaterDisplay, { type UpdaterSummary } from '../../../components/UpdaterDisplay';
import type { MemoryNode } from '../useMemoryBrowserController';
import KeywordManager from './KeywordManager';
import GlossaryHighlighter from './GlossaryHighlighter';
import MemoryViewsSection from './MemoryViewsSection';

interface MemoryNodeMetaProps {
  node: MemoryNode;
  editing: boolean;
  refreshData: () => Promise<void>;
  navigateTo: (newPath: string, newDomain?: string) => void;
  navigateToHistory: () => void;
  t: (key: string) => string;
}

export default function MemoryNodeMeta({
  node,
  editing,
  refreshData,
  navigateTo,
  navigateToHistory,
  t,
}: MemoryNodeMetaProps): React.JSX.Element | null {
  if (editing) return null;

  return (
    <div className="mb-6 space-y-3">
      {(node.aliases?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-[12px] text-txt-tertiary">
          <span>{t('Also:')}</span>
          {node.aliases?.map((alias) => (
            <Badge key={alias} tone="blue">{alias}</Badge>
          ))}
        </div>
      )}
      {node.disclosure && (
        <Notice tone="warning" className="max-w-2xl">
          {node.disclosure}
        </Notice>
      )}
      {node.created_at && (
        <p className="text-[11px] text-txt-quaternary">
          {t('Created')}: {new Date(node.created_at).toLocaleString()}
        </p>
      )}
      {node.last_updated_at && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-txt-quaternary">
          <span>{t('Last updated by')}:</span>
          <UpdaterDisplay
            updaters={node.updaters as UpdaterSummary[] | undefined}
            fallbackClientType={node.last_updated_client_type}
            fallbackSource={node.last_updated_source}
            fallbackUpdatedAt={node.last_updated_at}
            size="md"
            showTimestamp
            onOpenHistory={navigateToHistory}
          />
        </div>
      )}
      {!node.is_virtual && (
        <div className="rounded-2xl border border-separator-thin bg-bg-elevated px-4 py-4 shadow-card md:px-5">
          <KeywordManager keywords={node.glossary_keywords || []} nodeUuid={node.node_uuid || ''} onUpdate={() => void refreshData()} />
        </div>
      )}
      {Array.isArray(node.memory_views) && node.memory_views.length > 0 && (
        <MemoryViewsSection memoryViews={node.memory_views} t={t} />
      )}
      {node.content && (
        <div className="rounded-2xl border border-separator-thin bg-bg-elevated px-4 py-4 shadow-card md:px-6 md:py-5">
          <div className="prose max-w-none">
            <GlossaryHighlighter
              key={node.node_uuid}
              content={node.content}
              glossary={node.glossary_matches || []}
              currentNodeUuid={node.node_uuid || ''}
              onNavigate={navigateTo}
            />
          </div>
        </div>
      )}
    </div>
  );
}

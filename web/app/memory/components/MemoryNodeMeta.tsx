import React from 'react';
import UpdaterDisplay, { type UpdaterSummary } from '../../../components/UpdaterDisplay';
import type { MemoryNode } from '../useMemoryBrowserController';
import KeywordManager from './KeywordManager';
import GlossaryHighlighter from './GlossaryHighlighter';
import MemoryViewsSection from './MemoryViewsSection';

function MemoryNodeProperties({
  node,
  refreshData,
  navigateToHistory,
  t,
}: {
  node: MemoryNode;
  refreshData: () => Promise<void>;
  navigateToHistory: () => void;
  t: (key: string) => string;
}): React.JSX.Element {
  const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : '';

  return (
    <div className="space-y-3">
      {node.disclosure && (
        <blockquote className="max-w-3xl border-l-2 border-separator pl-3 text-[13px] leading-relaxed text-txt-tertiary italic">
          {node.disclosure}
        </blockquote>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-txt-quaternary">
        {node.last_updated_at ? (
          <span title={formatTime(node.last_updated_at)}>
            {t('Updated')}: {new Date(node.last_updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : node.created_at ? (
          <span title={formatTime(node.created_at)}>
            {t('Created')}: {new Date(node.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : null}
        {node.last_updated_at && (
          <span className="flex flex-wrap items-center gap-1.5">
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
        {!node.is_virtual && (
          <KeywordManager keywords={node.glossary_keywords || []} nodeUuid={node.node_uuid || ''} onUpdate={() => void refreshData()} />
        )}
      </div>
    </div>
  );
}

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
    <div className="mb-6 space-y-4">
      <div className="rounded-2xl border border-separator-thin bg-bg-elevated px-4 py-4 shadow-card md:px-6 md:py-5">
        <MemoryNodeProperties node={node} refreshData={refreshData} navigateToHistory={navigateToHistory} t={t} />
      </div>
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

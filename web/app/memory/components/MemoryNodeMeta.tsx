import React from 'react';
import clsx from 'clsx';
import type { MemoryNode } from '../useMemoryBrowserController';
import GlossaryHighlighter from './GlossaryHighlighter';
import { surfaceCardClassName } from '../../../components/ui';
import MemoryViewsSection from './MemoryViewsSection';

interface MemoryNodeMetaProps {
  node: MemoryNode;
  domain: string;
  path: string;
  editing: boolean;
  refreshData: () => Promise<void>;
  navigateTo: (newPath: string, newDomain?: string) => void;
  navigateToHistory: () => void;
  t: (key: string) => string;
}

export default function MemoryNodeMeta({
  node,
  domain,
  path,
  editing,
  refreshData,
  navigateTo,
  navigateToHistory,
  t,
}: MemoryNodeMetaProps): React.JSX.Element | null {
  if (editing) return null;

  const hasCoreContent = Boolean(node.disclosure || node.content);
  const hasViews = Array.isArray(node.memory_views) && node.memory_views.length > 0;
  if (!hasCoreContent && !hasViews) return null;

  return (
    <div className="mb-7 space-y-10">
      {hasCoreContent && (
        <article className={clsx(surfaceCardClassName, 'overflow-hidden px-5 py-5 md:px-7 md:py-7')} data-memory-core-card="true">
          {node.disclosure && (
            <section
              className={clsx(node.content && 'border-b border-separator-hairline pb-5')}
              data-memory-disclosure-section="true"
            >
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-txt-tertiary">
                {t('Trigger / summary')}
              </div>
              <p className="text-[15px] leading-relaxed text-txt-primary">{node.disclosure}</p>
            </section>
          )}
          {node.content && (
            <section
              className={clsx(node.disclosure && 'pt-5')}
              data-memory-payload-section="true"
            >
              <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-txt-tertiary">
                {t('Memory content')}
              </div>
              <div className="prose max-w-none">
                <GlossaryHighlighter
                  key={node.node_uuid}
                  content={node.content}
                  glossary={node.glossary_matches || []}
                  currentNodeUuid={node.node_uuid || ''}
                  onNavigate={navigateTo}
                />
              </div>
            </section>
          )}
        </article>
      )}
      {hasViews && (
        <div className="pt-2" data-memory-advanced-section="true">
          <MemoryViewsSection memoryViews={node.memory_views || []} t={t} />
        </div>
      )}
    </div>
  );
}

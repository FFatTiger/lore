import React from 'react';
import { Badge } from '../../../components/ui';
import type { MemoryView } from '../useMemoryBrowserController';

interface MemoryViewsSectionProps {
  memoryViews: MemoryView[];
  t: (key: string) => string;
}

export default function MemoryViewsSection({ memoryViews, t }: MemoryViewsSectionProps): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-separator-thin bg-bg-elevated px-4 py-4 shadow-card md:px-5">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">
        {t('Retrieval views')} · {memoryViews.length}
      </h2>
      <div className="space-y-3">
        {memoryViews.map((view) => {
          const llmRefined = view?.metadata?.llm_refined === true;
          const llmModel = view?.metadata?.llm_model || null;
          return (
            <div
              key={String(view.id || `${view.view_type}-${view.updated_at}`)}
              className="rounded-xl border border-separator-thin bg-bg-raised p-3 md:p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Badge tone="blue">{view.view_type}</Badge>
                <Badge tone="default">w {Number(view.weight || 0).toFixed(2)}</Badge>
                <Badge tone="default">{view.status}</Badge>
                <Badge tone={llmRefined ? 'purple' : 'default'}>{llmRefined ? 'LLM' : 'rule'}</Badge>
                {llmModel && <span className="text-[10px] font-mono text-sys-green">{llmModel}</span>}
              </div>
              <div className="mb-2 text-[10px] font-mono text-txt-quaternary">
                {view.embedding_model || 'pending'}
                {view.updated_at ? <> · {new Date(view.updated_at).toLocaleString()}</> : null}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-[12.5px] leading-relaxed text-txt-secondary">{view.text_content}</pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

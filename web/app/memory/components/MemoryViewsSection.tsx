import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge } from '../../../components/ui';
import type { MemoryView } from '../useMemoryBrowserController';

interface MemoryViewsSectionProps {
  memoryViews: MemoryView[];
  t: (key: string) => string;
}

export default function MemoryViewsSection({ memoryViews, t }: MemoryViewsSectionProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:text-sys-blue md:px-6"
        aria-expanded={open}
      >
        <span className="text-[13px] font-semibold text-txt-primary">{t('Retrieval views')} {memoryViews.length}</span>
        <ChevronRight size={15} className={open ? 'rotate-90 text-txt-tertiary transition-transform' : 'text-txt-tertiary transition-transform'} />
      </button>
      {open && (
        <div className="border-t border-separator-hairline">
          {memoryViews.map((view, index) => {
            const llmRefined = view?.metadata?.llm_refined === true;
            const llmModel = view?.metadata?.llm_model || null;
            return (
              <div
                key={String(view.id || `${view.view_type}-${view.updated_at}`)}
                className={index > 0 ? 'border-t border-separator-hairline px-4 py-3 md:px-6' : 'px-4 py-3 md:px-6'}
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium text-txt-primary">{view.view_type}</span>
                  <span className="font-mono text-[11px] text-txt-tertiary">{t('Relevance')} {Number(view.weight || 0).toFixed(2)}</span>
                  {view.status && <Badge tone={view.status === 'active' ? 'green' : 'soft'}>{view.status}</Badge>}
                </div>
                <pre className="mb-2 max-h-24 overflow-hidden whitespace-pre-wrap text-[12.5px] leading-relaxed text-txt-secondary">{view.text_content}</pre>
                <details className="text-[10.5px] text-txt-quaternary">
                  <summary className="w-fit cursor-pointer select-none hover:text-txt-secondary">{t('Details')}</summary>
                  <div className="mt-1 font-mono">
                    {view.embedding_model || t('Pending')}
                    {view.updated_at ? <> · {new Date(view.updated_at).toLocaleString()}</> : null}
                    {llmRefined ? <> · {t('LLM refined')}</> : <> · {t('Rule')}</>}
                    {llmModel ? <> · {llmModel}</> : null}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

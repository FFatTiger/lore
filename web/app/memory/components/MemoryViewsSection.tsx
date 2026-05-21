import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Badge, Section, TextButton } from '../../../components/ui';
import type { MemoryView } from '../useMemoryBrowserController';

interface MemoryViewsSectionProps {
  memoryViews: MemoryView[];
  t: (key: string) => string;
  defaultOpen?: boolean;
}

export default function MemoryViewsSection({ memoryViews, t, defaultOpen = false }: MemoryViewsSectionProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Section
      compact
      padded={false}
      title={(
        <span className="inline-flex items-center gap-2">
          <span>{t('Retrieval views')}</span>
          <Badge size="sm" tone="soft" mono>{memoryViews.length}</Badge>
        </span>
      )}
      right={(
        <TextButton
          type="button"
          tone="default"
          size="sm"
          title={open ? t('Hide') : t('Show')}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight size={15} className={clsx('transition-transform', open && 'rotate-90')} />
        </TextButton>
      )}
    >
      {open ? (
        <div className="border-t border-separator-hairline">
          {memoryViews.map((view, index) => {
            const llmRefined = view?.metadata?.llm_refined === true;
            const llmModel = view?.metadata?.llm_model || null;
            return (
              <div
                key={String(view.id || `${view.view_type}-${view.updated_at}`)}
                className={index > 0 ? 'border-t border-separator-hairline px-5 py-5 md:px-6' : 'px-5 py-5 md:px-6'}
              >
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold text-txt-primary">{view.view_type}</span>
                  <span className="font-mono text-[12px] text-txt-tertiary">{t('Relevance')} {Number(view.weight || 0).toFixed(2)}</span>
                  {view.status && <Badge tone={view.status === 'active' ? 'green' : 'soft'}>{view.status}</Badge>}
                </div>
                <pre className="mb-4 max-h-56 overflow-hidden rounded-lg bg-bg-inset px-4 py-4 whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-txt-secondary">{view.text_content}</pre>
                <details className="text-[12px] text-txt-quaternary">
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
      ) : undefined}
    </Section>
  );
}

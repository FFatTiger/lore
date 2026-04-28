import React from 'react';
import UpdaterDisplay, { type UpdaterSummary } from '../../../components/UpdaterDisplay';
import PriorityBadge from './PriorityBadge';
import { useT } from '../../../lib/i18n';

interface ChildItem {
  domain?: string;
  path: string;
  name?: string;
  priority?: number | null;
  disclosure?: string;
  content_snippet?: string;
  last_updated_client_type?: string | null;
  last_updated_source?: string | null;
  last_updated_at?: string | null;
  updaters?: UpdaterSummary[];
}

interface MemoryChildrenListProps {
  childItems: ChildItem[] | null | undefined;
  domain: string;
  isRoot: boolean;
  navigateTo: (path: string, domain?: string) => void;
  navigateToHistory?: (path: string, domain?: string) => void;
}

export default function MemoryChildrenList({ childItems, domain, isRoot, navigateTo, navigateToHistory }: MemoryChildrenListProps): React.JSX.Element | null {
  const { t } = useT();
  if (!childItems?.length) return null;

  return (
    <div className="pt-4">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">
        {isRoot ? t('Clusters') : t('Children')} · {childItems.length}
      </h3>

      <div className="space-y-2">
        {childItems.map((child) => (
          <button
            key={`${child.domain || domain}:${child.path}`}
            onClick={() => navigateTo(child.path, child.domain)}
            className="child-card group"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="child-card-title">{child.path.split('/').pop() || child.path}</span>
                {child.domain && child.domain !== domain && (
                  <span className="cross-domain-badge">{child.domain}</span>
                )}
                <PriorityBadge priority={child.priority} />
                {child.last_updated_at && (
                  <UpdaterDisplay
                    updaters={child.updaters}
                    fallbackClientType={child.last_updated_client_type}
                    fallbackSource={child.last_updated_source}
                    fallbackUpdatedAt={child.last_updated_at}
                    size="sm"
                    onOpenHistory={navigateToHistory ? () => navigateToHistory(child.path, child.domain || domain) : undefined}
                  />
                )}
              </div>
              <p className="child-card-desc">{child.path}</p>
              {child.disclosure && (
                <p className="mt-1.5 line-clamp-2 text-[12.5px] text-sys-orange">{child.disclosure}</p>
              )}
              {child.content_snippet ? (
                <p className="child-card-snippet">{child.content_snippet}</p>
              ) : (
                <p className="child-card-snippet text-txt-quaternary">{t('Empty')}</p>
              )}
            </div>
            <span className="shrink-0 self-center text-[13px] text-txt-tertiary group-hover:text-sys-blue transition-colors">
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

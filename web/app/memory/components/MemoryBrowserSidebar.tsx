'use client';

import React from 'react';
import { PanelLeftClose } from 'lucide-react';
import clsx from 'clsx';
import type { DomainItem } from '../useMemoryBrowserController';
import DomainNode from './MemorySidebar';

interface MemoryBrowserSidebarProps {
  domains: DomainItem[];
  domain: string;
  path: string;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
  navigateTo: (newPath: string, newDomain?: string) => void;
  t: (key: string) => string;
}

export default function MemoryBrowserSidebar({
  domains,
  domain,
  path,
  sidebarOpen,
  setSidebarOpen,
  navigateTo,
  t,
}: MemoryBrowserSidebarProps): React.JSX.Element {
  const sidebarBody = (
    <>
      {domains.map((item) => (
        <DomainNode
          key={item.domain}
          domain={item.domain}
          rootCount={item.root_count}
          activeDomain={domain}
          activePath={path}
          onNavigate={navigateTo}
        />
      ))}
      {domains.length === 0 && (
        <DomainNode domain="core" activeDomain={domain} activePath={path} onNavigate={navigateTo} />
      )}
    </>
  );

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={clsx(
          'fixed top-[60px] left-0 bottom-0 z-40 flex w-[82vw] max-w-[300px] flex-col bg-bg-elevated shadow-[8px_0_24px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-spring md:hidden',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex flex-shrink-0 items-center justify-between px-4 pt-5 pb-3">
          <h2 className="text-[16px] font-semibold tracking-tight text-txt-primary">{t('Domains')}</h2>
          <button
            onClick={() => setSidebarOpen(false)}
            className="press -mr-1 rounded-md p-1 text-txt-tertiary hover:bg-fill-quaternary hover:text-txt-primary"
            aria-label={t('Hide tree')}
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{sidebarBody}</div>
        <div className="flex-shrink-0 border-t border-separator-hairline px-4 py-3">
          <code className="block break-all font-mono text-[10px] leading-snug text-txt-quaternary">
            {domain}://{path || 'root'}
          </code>
        </div>
      </div>

      {sidebarOpen && (
        <aside className="group sticky top-4 hidden max-h-[calc(100vh-96px)] w-52 shrink-0 self-start overflow-y-auto pr-1 md:block lg:w-56">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold tracking-tight text-txt-primary">{t('Domains')}</h2>
            <button
              onClick={() => setSidebarOpen(false)}
              className="press -mr-1 rounded-md p-1 text-txt-quaternary opacity-0 transition-opacity group-hover:opacity-100 hover:text-txt-secondary"
              aria-label={t('Hide tree')}
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
          {sidebarBody}
          <div className="mt-6 border-t border-separator-hairline pt-4">
            <code className="block break-all font-mono text-[10px] leading-snug text-txt-quaternary">
              {domain}://{path || 'root'}
            </code>
          </div>
        </aside>
      )}
    </>
  );
}

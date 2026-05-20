'use client';

import React from 'react';
import clsx from 'clsx';
import { OutlineNavFloatingPanel, OutlineNavShell } from '../../../components/ui';
import type { DomainItem } from '../useMemoryBrowserController';
import DomainNode from './MemorySidebar';
interface MemoryBrowserSidebarProps {
  domains: DomainItem[];
  domain: string;
  path: string;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
  navigateTo: (newPath: string, newDomain?: string) => void;
  treeVersion: number;
  t: (key: string) => string;
}

export default function MemoryBrowserSidebar({
  domains,
  domain,
  path,
  sidebarOpen,
  setSidebarOpen,
  navigateTo,
  treeVersion,
  t,
}: MemoryBrowserSidebarProps): React.JSX.Element {
  const sidebarBody = (
    <>
      {domains.map((item) => (
        <DomainNode
          key={`${item.domain}:${treeVersion}`}
          domain={item.domain}
          rootCount={item.root_count}
          activeDomain={domain}
          activePath={path}
          onNavigate={navigateTo}
        />
      ))}
      {domains.length === 0 && (
        <DomainNode key={`core:${treeVersion}`} domain="core" activeDomain={domain} activePath={path} onNavigate={navigateTo} />
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
          'fixed top-[60px] left-0 bottom-0 z-40 flex w-[82vw] max-w-[300px] flex-col bg-bg-elevated transition-transform duration-200 ease-spring md:hidden',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="hover-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <OutlineNavShell
            ariaLabel={t('Domains')}
            title={t('Domains')}
          >
            {sidebarBody}
          </OutlineNavShell>
        </div>
        <div className="flex-shrink-0 border-t border-separator-hairline px-4 py-3">
          <code className="block break-all font-mono text-[10px] leading-snug text-txt-quaternary">
            {domain}://{path || 'root'}
          </code>
        </div>
      </div>

      {sidebarOpen && (
        <OutlineNavFloatingPanel
          ariaLabel={t('Domains')}
          breakpoint="md"
          left="max(1.5rem, calc((100vw - 1400px) / 2 + 1.5rem))"
          panelClassName="w-52 lg:w-56"
          placeholderClassName="w-52 lg:w-56"
          title={t('Domains')}
          footer={(
            <code className="block break-all font-mono text-[10px] leading-snug text-txt-quaternary">
              {domain}://{path || 'root'}
            </code>
          )}
        >
          {sidebarBody}
        </OutlineNavFloatingPanel>
      )}
    </>
  );
}

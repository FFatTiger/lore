'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Edit3, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { Button, Badge } from '../../components/ui';
import { useT } from '../../lib/i18n';
import PriorityBadge from './components/PriorityBadge';
import KeywordManager from './components/KeywordManager';
import DomainNode from './components/MemorySidebar';
import GlossaryHighlighter from './components/GlossaryHighlighter';
import MemoryEditor from './components/MemoryEditor';
import MemoryChildrenList from './components/MemoryChildrenList';
import { AxiosError } from 'axios';

interface SkeletonLineProps {
  w?: string;
}

function SkeletonLine({ w = '100%' }: SkeletonLineProps): React.JSX.Element {
  return <div className="h-3 rounded-md skeleton" style={{ width: w }} />;
}

interface MemoryView {
  id?: string | number;
  view_type: string;
  weight?: number;
  status?: string;
  updated_at?: string;
  embedding_model?: string;
  text_content?: string;
  metadata?: {
    llm_refined?: boolean;
    llm_model?: string;
  };
}

interface GlossaryMatch {
  keyword?: string;
  nodes?: Array<{
    uri?: string;
    node_uuid?: string;
    content_snippet?: string;
  }>;
}

interface MemoryNode {
  name?: string;
  content?: string;
  disclosure?: string;
  priority?: number | null;
  aliases?: string[];
  is_virtual?: boolean;
  node_uuid?: string;
  glossary_keywords?: string[];
  memory_views?: MemoryView[];
  glossary_matches?: GlossaryMatch[];
}

interface Breadcrumb {
  path?: string;
  label: string;
}

interface ChildItem {
  domain?: string;
  path: string;
  name?: string;
  priority?: number | null;
  disclosure?: string;
  content_snippet?: string;
}

interface DomainItem {
  domain: string;
  root_count?: number;
}

interface BrowseData {
  node: MemoryNode | null;
  children: ChildItem[];
  breadcrumbs: Breadcrumb[];
}

export default function MemoryBrowser(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const domain = searchParams?.get('domain') || 'core';
  const path = searchParams?.get('path') || '';
  const { t } = useT();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BrowseData>({ node: null, children: [], breadcrumbs: [] });
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editDisclosure, setEditDisclosure] = useState('');
  const [editPriority, setEditPriority] = useState(0);
  const [saving, setSaving] = useState(false);

  const currentRouteRef = useRef({ domain, path });
  useEffect(() => { currentRouteRef.current = { domain, path }; }, [domain, path]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) setSidebarOpen(true);
  }, []);

  useEffect(() => {
    api.get('/browse/domains').then((r) => setDomains(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true); setError(null); setEditing(false);
      try {
        const res = await api.get('/browse/node', { params: { domain, path } });
        setData(res.data);
        setEditContent(res.data.node?.content || '');
        setEditDisclosure(res.data.node?.disclosure || '');
        setEditPriority(res.data.node?.priority ?? 0);
      } catch (err) {
        const axiosErr = err as AxiosError<{ detail?: string }>;
        setError(axiosErr.response?.data?.detail || axiosErr.message);
      } finally { setLoading(false); }
    };
    fetchData();
  }, [domain, path]);

  const navigateTo = useCallback((newPath: string, newDomain?: string) => {
    const params = new URLSearchParams();
    params.set('domain', newDomain || domain);
    if (newPath) params.set('path', newPath);
    router.push(`/memory?${params.toString()}`);
    if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false);
  }, [domain, router]);

  const refreshData = () =>
    api.get('/browse/node', { params: { domain, path } }).then((res) => {
      setData((cd) => currentRouteRef.current.domain === domain && currentRouteRef.current.path === path ? res.data : cd);
    });

  const startEditing = () => {
    setEditContent(data.node?.content || '');
    setEditDisclosure(data.node?.disclosure || '');
    setEditPriority(data.node?.priority ?? 0);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (editContent !== (data.node?.content || '')) payload.content = editContent;
      if (editPriority !== (data.node?.priority ?? 0)) payload.priority = editPriority;
      if (editDisclosure !== (data.node?.disclosure || '')) payload.disclosure = editDisclosure;
      if (!Object.keys(payload).length) { setEditing(false); return; }
      await api.put('/browse/node', payload, { params: { domain, path } });
      await refreshData();
      setEditing(false);
    } catch (err) {
      const axiosErr = err as AxiosError;
      alert(`Save failed: ${axiosErr.message}`);
    }
    finally { setSaving(false); }
  };

  const isRoot = !path;
  const node = data.node;

  // Sidebar tree content — shared between desktop text-only and mobile drawer card
  const sidebarBody = (
    <>
      {domains.map((d) => (
        <DomainNode key={d.domain} domain={d.domain} rootCount={d.root_count}
          activeDomain={domain} activePath={path} onNavigate={navigateTo} />
      ))}
      {domains.length === 0 && (
        <DomainNode domain="core" activeDomain={domain} activePath={path} onNavigate={navigateTo} />
      )}
    </>
  );

  // PageTitle-style header: breadcrumb eyebrow + node title + description + right actions
  const headerBreadcrumbs = data.breadcrumbs || [];
  const fallbackDescription = node?.disclosure
    ? null
    : isRoot
      ? t('Agent memory graph')
      : data.children?.length > 0
        ? `${data.children.length} ${t(isRoot ? 'Clusters' : 'Children')}`
        : null;

  const pageHeader = node ? (
    <div className="mb-6 md:mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6 animate-in">
      <div className="min-w-0">
        {/* eyebrow = Memory label + breadcrumb path */}
        <nav className="mb-2 flex items-center gap-1 text-[11px] md:text-[12px] font-medium uppercase tracking-[0.08em] flex-wrap">
          <button
            onClick={() => navigateTo('', domain)}
            className="text-sys-blue hover:opacity-80 transition-opacity"
          >
            {t('Memory')}
          </button>
          {headerBreadcrumbs.slice(1, -1).map((crumb) => (
            <React.Fragment key={crumb.path || 'root'}>
              <span className="text-txt-quaternary">/</span>
              <button
                onClick={() => navigateTo(crumb.path || '')}
                className="text-sys-blue/70 hover:text-sys-blue transition-colors truncate max-w-[12rem]"
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="flex items-start gap-3">
          <h1 className="font-display text-[28px] sm:text-[34px] md:text-[44px] font-bold leading-[1.1] tracking-[-0.02em] text-txt-primary min-w-0 break-words">
            {path ? path.split('/').pop() : 'root'}
          </h1>
          {!editing && node.priority != null && (
            <div className="mt-2"><PriorityBadge priority={node.priority} size="lg" /></div>
          )}
        </div>
        {node.disclosure && !editing && (
          <p className="mt-2 md:mt-3 text-[14px] md:text-[16px] leading-relaxed text-sys-orange max-w-2xl">
            {node.disclosure}
          </p>
        )}
        {!node.disclosure && fallbackDescription && (
          <p className="mt-2 md:mt-3 text-[14px] md:text-[16px] leading-relaxed text-txt-secondary max-w-2xl">
            {fallbackDescription}
          </p>
        )}
        {(node.aliases?.length ?? 0) > 0 && !editing && (
          <div className="mt-3 flex items-center gap-2 flex-wrap text-[12px] text-txt-tertiary">
            <span>{t('Also:')}</span>
            {node.aliases?.map((a) => (
              <code key={a} className="font-mono text-[11.5px] text-sys-blue bg-sys-blue/10 px-1.5 py-0.5 rounded-md">{a}</code>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {!sidebarOpen && (
          <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(true)}>
            <PanelLeftOpen size={14} /> {t('Tree')}
          </Button>
        )}
        {!editing && (
          <Button variant="ghost" size="sm" onClick={startEditing}>
            <Edit3 size={14} /> {t('Edit')}
          </Button>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="h-full w-full overflow-y-auto">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar — full-height edge drawer, edge-to-edge */}
      <div
        className={clsx(
          'md:hidden fixed top-[60px] left-0 bottom-0 z-40 w-[82vw] max-w-[300px] bg-bg-elevated shadow-[8px_0_24px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-spring flex flex-col',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
          <h2 className="text-[16px] font-semibold tracking-tight text-txt-primary">{t('Domains')}</h2>
          <button
            onClick={() => setSidebarOpen(false)}
            className="press -mr-1 p-1 rounded-md text-txt-tertiary hover:bg-fill-quaternary hover:text-txt-primary"
            aria-label={t('Hide tree')}
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pb-2 min-h-0 px-2">
          {sidebarBody}
        </div>
        <div className="border-t border-separator-hairline px-4 py-3 flex-shrink-0">
          <code className="block break-all font-mono text-[10px] leading-snug text-txt-quaternary">
            {domain}://{path || 'root'}
          </code>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-4 md:px-6 py-4 md:py-8">
        <div className="flex gap-5 md:gap-10">
          {/* Desktop sidebar — no card, text directly on the canvas */}
          {sidebarOpen && (
            <aside className="hidden md:block sticky top-4 self-start w-52 lg:w-56 shrink-0 max-h-[calc(100vh-96px)] overflow-y-auto group pr-1">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[15px] font-semibold tracking-tight text-txt-primary">{t('Domains')}</h2>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="press -mr-1 p-1 rounded-md text-txt-quaternary opacity-0 group-hover:opacity-100 hover:text-txt-secondary transition-opacity"
                  aria-label={t('Hide tree')}
                >
                  <PanelLeftClose size={14} />
                </button>
              </div>
              {sidebarBody}
              <div className="border-t border-separator-hairline mt-6 pt-4">
                <code className="block break-all font-mono text-[10px] leading-snug text-txt-quaternary">
                  {domain}://{path || 'root'}
                </code>
              </div>
            </aside>
          )}

          {/* Main content */}
          <main className="flex-1 min-w-0">
            {loading ? (
              <div className="space-y-5 animate-in">
                <SkeletonLine w="50%" />
                <SkeletonLine w="30%" />
                <div className="h-40 rounded-2xl skeleton" />
                <div className="space-y-3">
                  <SkeletonLine /> <SkeletonLine w="90%" /> <SkeletonLine w="75%" />
                </div>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
                <p className="text-[16px] text-sys-red">{error}</p>
                <Button variant="secondary" onClick={() => navigateTo('', domain)}>{t('Return to root')}</Button>
              </div>
            ) : (
              <>
                {pageHeader}

                {/* Editor sits where content will show */}
                {editing && (
                  <MemoryEditor
                    editContent={editContent} setEditContent={setEditContent}
                    editDisclosure={editDisclosure} setEditDisclosure={setEditDisclosure}
                    editPriority={editPriority} setEditPriority={setEditPriority}
                    saving={saving} onSave={handleSave} onCancel={() => setEditing(false)}
                  />
                )}

                <div className="space-y-6">
                  {/* Glossary keyword manager */}
                  {!editing && node && !node.is_virtual && (
                    <div className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-card px-4 md:px-5 py-4">
                      <KeywordManager keywords={node.glossary_keywords || []} nodeUuid={node.node_uuid || ''} onUpdate={refreshData} />
                    </div>
                  )}

                  {/* Retrieval views */}
                  {!editing && node && Array.isArray(node.memory_views) && node.memory_views.length > 0 && (
                    <div className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-card px-4 md:px-5 py-4">
                      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">
                        {t('Retrieval views')} · {node.memory_views.length}
                      </h2>
                      <div className="space-y-3">
                        {node.memory_views.map((view) => {
                          const llmRefined = view?.metadata?.llm_refined === true;
                          const llmModel = view?.metadata?.llm_model || null;
                          return (
                            <div key={String(view.id || `${view.view_type}-${view.updated_at}`)}
                              className="rounded-xl border border-separator-thin bg-bg-raised p-3 md:p-4">
                              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                <Badge tone="blue">{view.view_type}</Badge>
                                <Badge tone="default">w {Number(view.weight || 0).toFixed(2)}</Badge>
                                <Badge tone="default">{view.status}</Badge>
                                <Badge tone={llmRefined ? 'purple' : 'default'}>{llmRefined ? 'LLM' : 'rule'}</Badge>
                                {llmModel && <span className="text-[10px] font-mono text-sys-green">{llmModel}</span>}
                              </div>
                              <div className="text-[10px] font-mono text-txt-quaternary mb-2">
                                {view.embedding_model || 'pending'}
                                {view.updated_at ? <> · {new Date(view.updated_at).toLocaleString()}</> : null}
                              </div>
                              <pre className="overflow-x-auto whitespace-pre-wrap text-[12.5px] leading-relaxed text-txt-secondary">{view.text_content}</pre>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Main content body */}
                  {!editing && node?.content && (
                    <div className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-card px-4 md:px-6 py-4 md:py-5">
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

                  {/* Children list */}
                  <MemoryChildrenList childItems={data.children} domain={domain} isRoot={isRoot} navigateTo={navigateTo} />

                  {!data.children?.length && !node?.content && !node?.memory_views?.length && (
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

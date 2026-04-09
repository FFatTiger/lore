'use client';

import React, { useState, useEffect, useRef, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface GlossaryNode {
  uri?: string;
  node_uuid?: string;
  content_snippet?: string;
}

interface PopupPosition {
  x: number;
  y: number;
  isAbove: boolean;
  spanTop: number;
}

interface PopupState {
  keyword: string;
  nodes: GlossaryNode[];
  position: PopupPosition;
}

interface GlossaryPopupProps {
  keyword: string;
  nodes: GlossaryNode[];
  position: PopupPosition;
  onClose: () => void;
  onNavigate: (path: string, domain: string) => void;
}

const GlossaryPopup = ({ keyword, nodes, position, onClose, onNavigate }: GlossaryPopupProps): React.JSX.Element => {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return createPortal(
    <div
      ref={popupRef}
      className="animate-scale fixed z-[100] flex w-80 flex-col rounded-2xl border border-separator-thin bg-bg-elevated shadow-card shadow-2xl shadow-black/60 backdrop-blur-xl"
      style={{
        left: Math.min(position.x, (typeof window !== 'undefined' ? window.innerWidth : 800) - 328),
        ...(position.isAbove
          ? { bottom: (typeof window !== 'undefined' ? window.innerHeight : 600) - position.spanTop + 8, maxHeight: position.spanTop - 24 }
          : { top: position.y + 8, maxHeight: (typeof window !== 'undefined' ? window.innerHeight : 600) - position.y - 24 }),
      }}
    >
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-separator-thin px-4 py-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">Entry</span>
        <span className="text-[14px] font-semibold text-sys-yellow truncate">{keyword}</span>
        <button onClick={onClose} className="press ml-auto text-txt-tertiary hover:text-txt-primary">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {nodes.map((node, i) => {
          const isUnlinked = node.uri?.startsWith('unlinked://');
          return (
            <button
              key={node.uri || i}
              onClick={() => {
                if (isUnlinked) return;
                const match = node.uri?.match(/^([^:]+):\/\/(.*)$/);
                if (match) onNavigate(match[2], match[1]);
                onClose();
              }}
              className={clsx(
                'press group w-full rounded-xl px-3 py-2.5 text-left transition-colors',
                isUnlinked ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-fill-quaternary',
              )}
            >
              <div className="flex items-center gap-2">
                <code className={clsx(
                  'flex-1 truncate font-mono text-[11.5px]',
                  isUnlinked ? 'text-txt-tertiary' : 'text-txt-primary group-hover:text-sys-blue',
                )}>
                  {node.uri}
                </code>
                {isUnlinked && (
                  <span className="rounded-md bg-sys-red/15 px-1.5 py-0.5 text-[9px] font-medium text-sys-red">orphan</span>
                )}
              </div>
              {node.content_snippet && (
                <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-txt-secondary">{node.content_snippet}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
};

interface GlossaryEntry {
  keyword?: string;
  nodes?: GlossaryNode[];
}

interface GlossaryHighlighterProps {
  content: string;
  glossary: GlossaryEntry[];
  currentNodeUuid: string;
  onNavigate: (path: string, domain?: string) => void;
}

const GlossaryHighlighter = ({ content, glossary, currentNodeUuid, onNavigate }: GlossaryHighlighterProps): React.JSX.Element => {
  const [popup, setPopup] = useState<PopupState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setPopup(null); }, [content]);

  const filteredGlossary = useMemo((): GlossaryEntry[] => {
    if (!glossary) return [];
    return glossary
      .map((entry) => ({ ...entry, nodes: entry.nodes?.filter((n) => n.node_uuid !== currentNodeUuid) || [] }))
      .filter((entry) => (entry.nodes?.length ?? 0) > 0);
  }, [glossary, currentNodeUuid]);

  useEffect(() => {
    if (!filteredGlossary.length || !containerRef.current) return;
    const keywords = filteredGlossary.map((entry) => entry.keyword).filter(Boolean) as string[];
    if (!keywords.length) return;

    const walker = document.createTreeWalker(containerRef.current, NodeFilter.SHOW_TEXT);
    const textNodes: Node[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    const keywordMap: Record<string, GlossaryEntry> = {};
    for (const entry of filteredGlossary) if (entry.keyword) keywordMap[entry.keyword] = entry;

    for (const textNode of textNodes) {
      const parentEl = textNode.parentElement;
      if (!parentEl) continue;
      if (parentEl.closest('code, pre, a, .glossary-keyword')) continue;

      const text = textNode.textContent;
      if (!text) continue;

      const matches: { start: number; end: number; keyword: string }[] = [];
      for (const kw of keywords) {
        let idx = text.indexOf(kw);
        while (idx !== -1) { matches.push({ start: idx, end: idx + kw.length, keyword: kw }); idx = text.indexOf(kw, idx + kw.length); }
      }
      if (!matches.length) continue;

      matches.sort((a, b) => a.start - b.start);
      const filtered: typeof matches = [];
      let lastEnd = -1;
      for (const match of matches) {
        if (match.start >= lastEnd) { filtered.push(match); lastEnd = match.end; }
      }

      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const match of filtered) {
        if (match.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, match.start)));
        const span = document.createElement('span');
        span.className = 'glossary-keyword';
        span.textContent = text.slice(match.start, match.end);
        span.dataset.keyword = match.keyword;
        frag.appendChild(span);
        pos = match.end;
      }
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      textNode.parentNode?.replaceChild(frag, textNode);
    }

    const handleClick = (e: MouseEvent) => {
      const target = (e.target as Element).closest('.glossary-keyword') as HTMLElement | null;
      if (!target) return;
      const kw = target.dataset.keyword;
      if (!kw) return;
      const entry = keywordMap[kw];
      if (!entry) return;
      const rect = target.getBoundingClientRect();
      let x = rect.left;
      if (x + 288 > window.innerWidth - 16) x = window.innerWidth - 304;
      if (x < 16) x = 16;
      const estimatedHeight = 250;
      const isAbove = rect.bottom + estimatedHeight > window.innerHeight - 16 && rect.top > estimatedHeight + 16;
      setPopup({ keyword: kw, nodes: entry.nodes || [], position: { x, y: rect.bottom, isAbove, spanTop: rect.top } });
    };

    const container = containerRef.current;
    container.addEventListener('click', handleClick);
    return () => container?.removeEventListener('click', handleClick);
  }, [content, filteredGlossary]);

  return (
    <div ref={containerRef} className="relative">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      {popup && (
        <GlossaryPopup
          keyword={popup.keyword}
          nodes={popup.nodes}
          position={popup.position}
          onClose={() => setPopup(null)}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
};

export default GlossaryHighlighter;

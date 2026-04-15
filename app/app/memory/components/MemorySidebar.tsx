'use client';

import React, { useState, useEffect, useRef, MouseEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../../lib/api';

interface TreeChild {
  path: string;
  name: string;
  approx_children_count?: number;
}

interface TreeNodeProps {
  domain: string;
  path: string;
  name: string;
  childrenCount?: number;
  activeDomain: string;
  activePath: string;
  onNavigate: (path: string, domain?: string) => void;
  level: number;
}

const TreeNode = ({ domain, path, name, childrenCount, activeDomain, activePath, onNavigate, level }: TreeNodeProps): React.JSX.Element => {
  const isAncestor = activeDomain === domain && activePath.startsWith(`${path}/`);
  const isActive = activeDomain === domain && activePath === path;
  const [expanded, setExpanded] = useState(isAncestor || isActive);
  const [children, setChildren] = useState<TreeChild[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const prevActivePath = useRef(activePath);
  const prevActiveDomain = useRef(activeDomain);
  const hasChildren = fetched ? children.length > 0 : childrenCount === undefined || childrenCount > 0;

  useEffect(() => {
    if (expanded && !fetched && hasChildren) fetchChildren();
  }, [expanded, fetched, hasChildren]);

  useEffect(() => {
    const changed = activePath !== prevActivePath.current || activeDomain !== prevActiveDomain.current;
    if (changed && (isAncestor || isActive) && !expanded) setExpanded(true);
    prevActivePath.current = activePath;
    prevActiveDomain.current = activeDomain;
  }, [activePath, activeDomain, isAncestor, isActive, expanded]);

  const fetchChildren = async () => {
    setLoading(true);
    try {
      setChildren((await api.get('/browse/node', { params: { domain, path, nav_only: true } })).data.children);
      setFetched(true);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (isActive) { if (hasChildren) setExpanded(!expanded); }
    else { onNavigate(path, domain); if (!expanded && hasChildren) setExpanded(true); }
  };

  return (
    <div>
      <div
        className={clsx(
          'press flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-[13px] transition-colors',
          isActive
            ? 'bg-sys-blue/12 text-sys-blue font-semibold shadow-[inset_2px_0_0_0_currentColor]'
            : 'text-txt-secondary/90 hover:bg-fill-primary hover:text-txt-primary',
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        <div className="flex h-4 w-4 shrink-0 items-center justify-center"
          onClick={(e: MouseEvent<HTMLDivElement>) => { if (hasChildren) { e.stopPropagation(); setExpanded(!expanded); } }}>
          {loading ? (
            <div className="h-3 w-3 animate-spin rounded-full border border-fill-tertiary border-t-sys-blue" />
          ) : hasChildren ? (
            <ChevronRight size={11} className={clsx('text-txt-quaternary transition-transform', expanded && 'rotate-90')} />
          ) : null}
        </div>
        <span className="truncate flex-1">{name}</span>
      </div>
      {expanded && children.length > 0 && (
        <div>
          {children.map((c) => (
            <TreeNode key={c.path} domain={domain} path={c.path} name={c.path.split('/').pop() || c.path}
              childrenCount={c.approx_children_count}
              activeDomain={activeDomain} activePath={activePath}
              onNavigate={onNavigate} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

interface DomainNodeProps {
  domain: string;
  rootCount?: number;
  activeDomain: string;
  activePath: string;
  onNavigate: (path: string, domain?: string) => void;
}

const DomainNode = ({ domain, rootCount, activeDomain, activePath, onNavigate }: DomainNodeProps): React.JSX.Element => {
  const [expanded, setExpanded] = useState(activeDomain === domain);
  const [children, setChildren] = useState<TreeChild[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const prevActiveDomain = useRef(activeDomain);
  const prevActivePath = useRef(activePath);
  const hasChildren = fetched ? children.length > 0 : rootCount === undefined || rootCount > 0;

  useEffect(() => {
    if (expanded && !fetched && hasChildren) fetchChildren();
  }, [expanded, fetched, hasChildren]);

  useEffect(() => {
    const changed = activeDomain !== prevActiveDomain.current || activePath !== prevActivePath.current;
    if (changed && activeDomain === domain && !expanded) setExpanded(true);
    prevActiveDomain.current = activeDomain;
    prevActivePath.current = activePath;
  }, [activeDomain, activePath, domain, expanded]);

  const fetchChildren = async () => {
    setLoading(true);
    try {
      setChildren((await api.get('/browse/node', { params: { domain, path: '', nav_only: true } })).data.children);
      setFetched(true);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const isActive = activeDomain === domain && activePath === '';

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (isActive) { if (hasChildren) setExpanded(!expanded); }
    else { onNavigate('', domain); if (!expanded && hasChildren) setExpanded(true); }
  };

  return (
    <div className="mt-5 first:mt-0">
      {/* group label — weakened, just a heading */}
      <div
        className={clsx(
          'flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] transition-colors',
          isActive
            ? 'bg-sys-blue/10 text-sys-blue'
            : 'text-txt-tertiary hover:bg-fill-quaternary hover:text-txt-secondary',
        )}
        onClick={handleClick}
      >
        <div className="flex h-3 w-3 shrink-0 items-center justify-center"
          onClick={(e: MouseEvent<HTMLDivElement>) => { if (hasChildren) { e.stopPropagation(); setExpanded(!expanded); } }}>
          {loading ? (
            <div className="h-2.5 w-2.5 animate-spin rounded-full border border-fill-tertiary border-t-sys-blue" />
          ) : hasChildren ? (
            <ChevronRight size={9} className={clsx('transition-transform', expanded && 'rotate-90')} />
          ) : null}
        </div>
        <span className="flex-1 truncate">{domain}</span>
        {rootCount !== undefined && (
          <span className="tabular-nums text-txt-quaternary font-normal normal-case tracking-normal text-[10px]">
            {rootCount}
          </span>
        )}
      </div>
      {expanded && children.length > 0 && (
        <div className="mt-1">
          {children.map((c) => (
            <TreeNode key={c.path} domain={domain} path={c.path} name={c.path.split('/').pop() || c.path}
              childrenCount={c.approx_children_count}
              activeDomain={activeDomain} activePath={activePath}
              onNavigate={onNavigate} level={1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default DomainNode;

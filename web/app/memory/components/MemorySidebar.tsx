'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { OutlineNavGroup, OutlineNavItem } from '../../../components/ui';

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

  const handleClick = () => {
    if (isActive) { if (hasChildren) setExpanded(!expanded); }
    else { onNavigate(path, domain); if (!expanded && hasChildren) setExpanded(true); }
  };

  return (
    <div>
      <OutlineNavItem
        active={isActive}
        level={level}
        onClick={handleClick}
        title={name}
        left={loading ? (
          <div className="h-3 w-3 animate-spin rounded-full border border-fill-tertiary border-t-sys-blue" />
        ) : hasChildren ? (
          <ChevronRight size={11} className={clsx('text-txt-quaternary transition-transform', expanded && 'rotate-90')} />
        ) : (
          <span className="block h-3 w-3" />
        )}
      >
        {name}
      </OutlineNavItem>
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

  const handleClick = () => {
    if (isActive) { if (hasChildren) setExpanded(!expanded); }
    else { onNavigate('', domain); if (!expanded && hasChildren) setExpanded(true); }
  };

  return (
    <OutlineNavGroup
      label={domain}
      active={isActive}
      onClick={handleClick}
      right={rootCount !== undefined ? <span className="tabular-nums">{rootCount}</span> : null}
      left={loading ? (
        <div className="h-2.5 w-2.5 animate-spin rounded-full border border-fill-tertiary border-t-sys-blue" />
      ) : hasChildren ? (
        <ChevronRight size={9} className={clsx('transition-transform', expanded && 'rotate-90')} />
      ) : (
        <span className="block h-2.5 w-2.5" />
      )}
    >
      {expanded && children.length > 0 && (
        <div>
          {children.map((c) => (
            <TreeNode key={c.path} domain={domain} path={c.path} name={c.path.split('/').pop() || c.path}
              childrenCount={c.approx_children_count}
              activeDomain={activeDomain} activePath={activePath}
              onNavigate={onNavigate} level={0} />
          ))}
        </div>
      )}
    </OutlineNavGroup>
  );
};

export default DomainNode;

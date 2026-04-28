'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { buildUrlWithSearchParams, readStringParam } from '../../lib/url-state';

export interface MemoryView {
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

export interface GlossaryMatch {
  keyword?: string;
  nodes?: Array<{
    uri?: string;
    node_uuid?: string;
    content_snippet?: string;
  }>;
}

export interface MemoryNode {
  name?: string;
  content?: string;
  disclosure?: string;
  priority?: number | null;
  aliases?: string[];
  is_virtual?: boolean;
  node_uuid?: string;
  created_at?: string | null;
  glossary_keywords?: string[];
  memory_views?: MemoryView[];
  glossary_matches?: GlossaryMatch[];
  last_updated_client_type?: string | null;
  last_updated_source?: string | null;
  last_updated_at?: string | null;
  updaters?: Array<Record<string, unknown>>;
}

export interface Breadcrumb {
  path?: string;
  label: string;
}

export interface ChildItem {
  domain?: string;
  path: string;
  name?: string;
  priority?: number | null;
  disclosure?: string;
  content_snippet?: string;
  last_updated_client_type?: string | null;
  last_updated_source?: string | null;
  last_updated_at?: string | null;
  updaters?: Array<Record<string, unknown>>;
}

export interface DomainItem {
  domain: string;
  root_count?: number;
}

export interface BrowseData {
  node: MemoryNode | null;
  children: ChildItem[];
  breadcrumbs: Breadcrumb[];
}

interface ConfirmDialogOptions {
  message: string;
  destructive?: boolean;
  confirmLabel?: string;
}

type ConfirmDialog = (options: ConfirmDialogOptions) => Promise<boolean>;
type Translate = (key: string) => string;
type Notify = (message: string, type?: 'success' | 'error') => void;

interface UseMemoryBrowserControllerArgs {
  confirmDialog: ConfirmDialog;
  t: Translate;
  toast: Notify;
}

interface UseMemoryBrowserControllerResult {
  domain: string;
  path: string;
  data: BrowseData;
  domains: DomainItem[];
  node: MemoryNode | null;
  isRoot: boolean;
  loading: boolean;
  error: string | null;
  sidebarOpen: boolean;
  editing: boolean;
  editContent: string;
  editDisclosure: string;
  editPriority: number;
  saving: boolean;
  moving: boolean;
  creating: boolean;
  rebuildingViews: boolean;
  setSidebarOpen: (value: boolean) => void;
  setEditContent: (value: string) => void;
  setEditDisclosure: (value: string) => void;
  setEditPriority: (value: number) => void;
  setMoving: (value: boolean) => void;
  setCreating: (value: boolean) => void;
  navigateTo: (newPath: string, newDomain?: string) => void;
  navigateToHistory: () => void;
  refreshData: () => Promise<void>;
  startEditing: () => void;
  cancelEditing: () => void;
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleRebuildViews: () => Promise<void>;
}

export function useMemoryBrowserController({ confirmDialog, t, toast }: UseMemoryBrowserControllerArgs): UseMemoryBrowserControllerResult {
  const router = useRouter();
  const searchParams = useSearchParams();
  const domain = readStringParam(searchParams, 'domain', 'core');
  const path = readStringParam(searchParams, 'path', '');
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
  const [moving, setMoving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rebuildingViews, setRebuildingViews] = useState(false);
  const currentRouteRef = useRef({ domain, path });

  useEffect(() => {
    currentRouteRef.current = { domain, path };
  }, [domain, path]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) setSidebarOpen(true);
  }, []);

  useEffect(() => {
    void api.get('/browse/domains').then((response) => {
      setDomains(response.data as DomainItem[]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      setEditing(false);
      try {
        const response = await api.get('/browse/node', { params: { domain, path } });
        if (cancelled) return;
        const nextData = response.data as BrowseData;
        setData(nextData);
        setEditContent(nextData.node?.content || '');
        setEditDisclosure(nextData.node?.disclosure || '');
        setEditPriority(nextData.node?.priority ?? 0);
      } catch (err) {
        if (cancelled) return;
        const axiosErr = err as AxiosError<{ detail?: string }>;
        setError(axiosErr.response?.data?.detail || axiosErr.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [domain, path]);

  const navigateTo = useCallback((newPath: string, newDomain?: string) => {
    const href = buildUrlWithSearchParams(
      '/memory',
      searchParams,
      { domain: newDomain || domain, path: newPath },
      { path: '' },
    );
    router.push(href);
    if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false);
  }, [domain, router, searchParams]);

  const navigateToHistory = useCallback(() => {
    const href = buildUrlWithSearchParams(
      '/memory/history',
      searchParams,
      { domain, path },
      { path: '' },
    );
    router.push(href);
  }, [domain, path, router, searchParams]);

  const refreshData = useCallback(async () => {
    const route = currentRouteRef.current;
    const response = await api.get('/browse/node', { params: route });
    if (currentRouteRef.current.domain === route.domain && currentRouteRef.current.path === route.path) {
      setData(response.data as BrowseData);
    }
  }, []);

  const startEditing = useCallback(() => {
    setEditContent(data.node?.content || '');
    setEditDisclosure(data.node?.disclosure || '');
    setEditPriority(data.node?.priority ?? 0);
    setEditing(true);
  }, [data.node]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (editContent !== (data.node?.content || '')) payload.content = editContent;
      if (editPriority !== (data.node?.priority ?? 0)) payload.priority = editPriority;
      if (editDisclosure !== (data.node?.disclosure || '')) payload.disclosure = editDisclosure;
      if (!Object.keys(payload).length) {
        setEditing(false);
        return;
      }
      await api.put('/browse/node', payload, { params: currentRouteRef.current });
      await refreshData();
      setEditing(false);
    } catch (err) {
      const axiosErr = err as AxiosError;
      toast(`${t('Save failed')}: ${axiosErr.message}`);
    } finally {
      setSaving(false);
    }
  }, [data.node, editContent, editDisclosure, editPriority, refreshData, toast]);

  const handleDelete = useCallback(async () => {
    const ok = await confirmDialog({
      message: t('Delete this node and all its children? This cannot be undone.'),
      destructive: true,
      confirmLabel: t('Delete'),
    });
    if (!ok) return;
    try {
      await api.delete('/browse/node', { params: currentRouteRef.current });
      const parentPath = currentRouteRef.current.path.includes('/')
        ? currentRouteRef.current.path.split('/').slice(0, -1).join('/')
        : '';
      navigateTo(parentPath, currentRouteRef.current.domain);
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      toast(axiosErr.response?.data?.detail || axiosErr.message || t('Delete failed'));
    }
  }, [confirmDialog, navigateTo, t, toast]);

  const handleRebuildViews = useCallback(async () => {
    setRebuildingViews(true);
    try {
      await api.post('/browse/recall/rebuild');
      await refreshData();
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      toast(axiosErr.response?.data?.detail || axiosErr.message || t('Rebuild failed'));
    } finally {
      setRebuildingViews(false);
    }
  }, [refreshData, toast]);

  return {
    domain,
    path,
    data,
    domains,
    node: data.node,
    isRoot: !path,
    loading,
    error,
    sidebarOpen,
    editing,
    editContent,
    editDisclosure,
    editPriority,
    saving,
    moving,
    creating,
    rebuildingViews,
    setSidebarOpen,
    setEditContent,
    setEditDisclosure,
    setEditPriority,
    setMoving,
    setCreating,
    navigateTo,
    navigateToHistory,
    refreshData,
    startEditing,
    cancelEditing,
    handleSave,
    handleDelete,
    handleRebuildViews,
  };
}

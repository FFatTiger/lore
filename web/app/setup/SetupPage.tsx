'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import { Bot, RefreshCw, Save, Settings, Sparkles, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  Notice,
  PageCanvas,
  PageTitle,
  StatCard,
  inputClass,
} from '@/components/ui';
import { useT } from '@/lib/i18n';
import {
  dispatchBootStatusChanged,
  type BootStatusNode,
  type BootViewData,
} from '@/lib/bootSetup';
import {
  generateBootStatusDrafts,
  getBootStatus,
  saveBootStatus,
} from '@/lib/api';

interface NodeMessage {
  tone: 'success' | 'danger' | 'info';
  text: string;
}

function statusTone(state: BootStatusNode['state']): 'red' | 'orange' | 'green' {
  if (state === 'missing') return 'red';
  if (state === 'empty') return 'orange';
  return 'green';
}

function statusLabel(t: (key: string) => string, state: BootStatusNode['state']): string {
  if (state === 'missing') return t('Missing');
  if (state === 'empty') return t('Empty content');
  return t('Initialized');
}

function roleIcon(role: BootStatusNode['role']) {
  if (role === 'agent') return Bot;
  if (role === 'soul') return Sparkles;
  return User;
}

export default function SetupPage(): React.JSX.Element {
  const { t } = useT();
  const router = useRouter();
  const [boot, setBoot] = useState<BootViewData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirtyByUri, setDirtyByUri] = useState<Record<string, boolean>>({});
  const dirtyRef = useRef<Record<string, boolean>>({});
  const [nodeContext, setNodeContext] = useState<Record<string, string>>({});
  const [sharedContext, setSharedContext] = useState('');
  const [messages, setMessages] = useState<Record<string, NodeMessage>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingUris, setSavingUris] = useState<string[]>([]);
  const [generatingUris, setGeneratingUris] = useState<string[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    dirtyRef.current = dirtyByUri;
  }, [dirtyByUri]);

  const syncBootState = useCallback((next: BootViewData, syncUris: string[] = []) => {
    const syncSet = new Set(syncUris);
    setBoot(next);
    setDrafts((prev) => {
      const merged = { ...prev };
      for (const node of next.nodes) {
        if (syncSet.has(node.uri) || !(node.uri in merged) || !dirtyRef.current[node.uri]) {
          merged[node.uri] = node.content || '';
        }
      }
      return merged;
    });
    if (syncUris.length > 0) {
      setDirtyByUri((prev) => {
        const nextDirty = { ...prev };
        for (const uri of syncUris) delete nextDirty[uri];
        return nextDirty;
      });
    }
  }, []);

  const refreshBoot = useCallback(async (options?: { syncUris?: string[]; silent?: boolean; notify?: boolean }) => {
    const syncUris = options?.syncUris || [];
    if (!options?.silent) setRefreshing(true);
    setPageError(null);
    try {
      const next = await getBootStatus();
      syncBootState(next, syncUris);
      if (options?.notify) dispatchBootStatusChanged();
      if (next.overall_state === 'complete') {
        router.replace('/memory');
      }
      return next;
    } catch (error) {
      const axiosErr = error as AxiosError<{ detail?: string }>;
      setPageError(axiosErr.response?.data?.detail || axiosErr.message || t('Failed to load'));
      return null;
    } finally {
      if (!options?.silent) setRefreshing(false);
      setLoading(false);
    }
  }, [router, syncBootState, t]);

  useEffect(() => {
    void refreshBoot({ silent: true });
  }, [refreshBoot]);

  const nodes = boot?.nodes || [];
  const allUris = useMemo(() => nodes.map((node) => node.uri), [nodes]);
  const dirtyCount = useMemo(() => Object.keys(dirtyByUri).length, [dirtyByUri]);
  const savingSet = useMemo(() => new Set(savingUris), [savingUris]);
  const generatingSet = useMemo(() => new Set(generatingUris), [generatingUris]);

  const setNodeDraft = useCallback((uri: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [uri]: value }));
    setDirtyByUri((prev) => ({ ...prev, [uri]: true }));
  }, []);

  const setNodeMessage = useCallback((uri: string, message: NodeMessage | null) => {
    setMessages((prev) => {
      const next = { ...prev };
      if (message) next[uri] = message;
      else delete next[uri];
      return next;
    });
  }, []);

  const handleGenerate = useCallback(async (uris: string[]) => {
    if (!uris.length || !boot?.draft_generation_available) return;
    setGeneratingUris((prev) => [...new Set([...prev, ...uris])]);
    setPageError(null);
    try {
      const response = await generateBootStatusDrafts({
        uris,
        shared_context: sharedContext.trim() || undefined,
        node_context: Object.fromEntries(
          uris
            .map((uri) => [uri, (nodeContext[uri] || '').trim()])
            .filter(([, value]) => value),
        ),
      });

      setDrafts((prev) => {
        const next = { ...prev };
        for (const result of response.results) {
          if (result.status === 'generated' && result.content) next[result.uri] = result.content;
        }
        return next;
      });
      setDirtyByUri((prev) => {
        const next = { ...prev };
        for (const result of response.results) {
          if (result.status === 'generated' && result.content) next[result.uri] = true;
        }
        return next;
      });
      for (const result of response.results) {
        setNodeMessage(result.uri, result.status === 'generated'
          ? { tone: 'success', text: t('Draft generated') }
          : { tone: 'danger', text: result.detail || t('Failed to load') });
      }
    } catch (error) {
      const axiosErr = error as AxiosError<{ detail?: string }>;
      setPageError(axiosErr.response?.data?.detail || axiosErr.message || t('Failed to load'));
    } finally {
      setGeneratingUris((prev) => prev.filter((uri) => !uris.includes(uri)));
    }
  }, [boot?.draft_generation_available, nodeContext, setNodeMessage, sharedContext, t]);

  const handleSave = useCallback(async (uris: string[]) => {
    if (!uris.length) return;
    setSavingUris((prev) => [...new Set([...prev, ...uris])]);
    setPageError(null);
    try {
      const response = await saveBootStatus({
        nodes: Object.fromEntries(uris.map((uri) => [uri, drafts[uri] || ''])),
      });
      const syncedUris = response.results
        .filter((result) => result.status !== 'failed')
        .map((result) => result.uri);

      for (const result of response.results) {
        if (result.status === 'failed') {
          setNodeMessage(result.uri, { tone: 'danger', text: result.detail || t('Failed to load') });
          continue;
        }
        if (result.status === 'created') {
          setNodeMessage(result.uri, { tone: 'success', text: t('Created') });
        } else if (result.status === 'updated') {
          setNodeMessage(result.uri, { tone: 'success', text: t('Updated') });
        } else {
          setNodeMessage(result.uri, { tone: 'info', text: t('Unchanged') });
        }
      }

      await refreshBoot({ syncUris: syncedUris, notify: syncedUris.length > 0 });
    } catch (error) {
      const axiosErr = error as AxiosError<{ detail?: string }>;
      setPageError(axiosErr.response?.data?.detail || axiosErr.message || t('Failed to load'));
    } finally {
      setSavingUris((prev) => prev.filter((uri) => !uris.includes(uri)));
    }
  }, [drafts, refreshBoot, setNodeMessage, t]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-fill-tertiary border-t-sys-blue" />
      </div>
    );
  }

  return (
    <PageCanvas maxWidth="6xl">
      <PageTitle
        eyebrow={t('Setup required')}
        title={t('First-run setup')}
        description={t('Initialize the three fixed startup memories before entering the normal Lore workflow.')}
        right={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button variant="ghost" onClick={() => void refreshBoot()} disabled={refreshing || savingUris.length > 0 || generatingUris.length > 0}>
              {refreshing ? t('Refreshing…') : t('Refresh status')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => router.push('/settings')}
            >
              <Settings size={14} />
              {t('Open settings')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleGenerate(allUris)}
              disabled={!boot?.draft_generation_available || generatingUris.length > 0 || !allUris.length}
            >
              <Sparkles size={14} />
              {generatingUris.length > 0 ? t('Generating…') : t('Generate all drafts')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSave(allUris)}
              disabled={savingUris.length > 0 || !allUris.length}
            >
              <Save size={14} />
              {savingUris.length > 0 ? t('Saving…') : t('Save all')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <StatCard label={t('Startup nodes loaded')} value={`${boot?.loaded || 0}/${boot?.total || 0}`} compact />
        <StatCard label={t('Remaining')} value={boot?.remaining_count ?? 0} tone={(boot?.remaining_count || 0) > 0 ? 'orange' : 'green'} compact />
        <StatCard label={t('Draft model')} value={boot?.draft_generation_available ? t('Available') : t('Manual only')} hint={boot?.draft_generation_available ? undefined : (boot?.draft_generation_reason || undefined)} compact />
      </div>

      <div className="space-y-4">
        <Card>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-sys-blue">{t('Fixed boot baseline')}</div>
              <h2 className="mt-2 text-[20px] font-semibold tracking-tight text-txt-primary">{t('These three fixed paths load at startup for every Lore instance.')}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-txt-secondary">{t('You can write these manually, or use the configured View LLM to draft a first pass and then edit it before saving.')}</p>
            </div>
            <Badge tone={boot?.overall_state === 'complete' ? 'green' : 'orange'}>{t(boot?.overall_state === 'complete' ? 'Complete' : 'Setup required')}</Badge>
          </div>
          <div className="mt-4">
            <label className="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Shared draft context')}</label>
            <textarea
              value={sharedContext}
              onChange={(event) => setSharedContext(event.target.value)}
              placeholder={t('Optional shared context for all three draft generations')}
              className={`${inputClass} min-h-[88px] font-sans`}
            />
          </div>
        </Card>

        {!boot?.draft_generation_available && (
          <Notice tone="warning" title={t('Draft generation unavailable')}>
            <div className="space-y-2">
              <p>{t('You can still complete setup manually, or open Settings first and configure the default View LLM.')}</p>
              {boot?.draft_generation_reason && <p>{boot.draft_generation_reason}</p>}
            </div>
          </Notice>
        )}

        {pageError && (
          <Notice tone="danger" title={t('Failed to load')}>
            {pageError}
          </Notice>
        )}

        <div className="grid gap-4 xl:grid-cols-3">
          {nodes.map((node) => {
            const Icon = roleIcon(node.role);
            const message = messages[node.uri];
            const isSaving = savingSet.has(node.uri);
            const isGenerating = generatingSet.has(node.uri);
            return (
              <Card key={node.uri} className="flex h-full flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-fill-primary text-sys-blue">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-[17px] font-semibold tracking-tight text-txt-primary">{t(node.role_label)}</h3>
                        <Badge tone={statusTone(node.state)}>{statusLabel(t, node.state)}</Badge>
                        {dirtyByUri[node.uri] && <Badge tone="blue">{t('Unsaved')}</Badge>}
                      </div>
                      <div className="mt-1 text-[12px] font-mono text-txt-tertiary break-all">{node.uri}</div>
                      <p className="mt-2 text-[13px] leading-relaxed text-txt-secondary">{t(node.purpose)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  <div className="rounded-xl bg-fill-quaternary px-3 py-2">
                    <div className="text-txt-tertiary">{t('Status')}</div>
                    <div className="mt-1 font-medium text-txt-primary">{statusLabel(t, node.state)}</div>
                  </div>
                  <div className="rounded-xl bg-fill-quaternary px-3 py-2">
                    <div className="text-txt-tertiary">{t('Content length')}</div>
                    <div className="mt-1 font-medium text-txt-primary">{node.content_length}</div>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Draft prompt')}</label>
                  <input
                    type="text"
                    value={nodeContext[node.uri] || ''}
                    onChange={(event) => setNodeContext((prev) => ({ ...prev, [node.uri]: event.target.value }))}
                    placeholder={t('Optional extra guidance for this node')}
                    className={`${inputClass} font-sans`}
                  />
                </div>

                <div className="flex-1">
                  <label className="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Content')}</label>
                  <textarea
                    value={drafts[node.uri] || ''}
                    onChange={(event) => setNodeDraft(node.uri, event.target.value)}
                    placeholder={t('Write the final memory content here')}
                    className={`${inputClass} min-h-[220px] font-sans leading-relaxed`}
                  />
                </div>

                {message && (
                  <Notice tone={message.tone === 'success' ? 'success' : message.tone === 'danger' ? 'danger' : 'info'}>
                    {message.text}
                  </Notice>
                )}

                <div className="mt-auto flex items-center gap-2 flex-wrap">
                  <Button
                    variant="secondary"
                    onClick={() => void handleGenerate([node.uri])}
                    disabled={!boot?.draft_generation_available || isGenerating}
                  >
                    {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {isGenerating ? t('Generating…') : t('Generate draft')}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void handleSave([node.uri])}
                    disabled={isSaving}
                  >
                    {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                    {isSaving ? t('Saving…') : t('Save')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </PageCanvas>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AxiosError } from 'axios';
import { api } from '@/lib/api';
import type { SettingsData } from './SettingsSectionEditor';

const EMBEDDING_REBUILD_KEYS = new Set([
  'embedding.base_url',
  'embedding.api_key',
  'embedding.model',
]);

interface ConfirmDialogOptions {
  message: string;
  destructive?: boolean;
  confirmLabel?: string;
}

type ConfirmDialog = (options: ConfirmDialogOptions) => Promise<boolean>;
type Notify = (message: string, type: 'success' | 'error') => void;
type Translate = (key: string) => string;

interface UseSettingsFlowArgs {
  t: Translate;
  confirmDialog: ConfirmDialog;
  notify: Notify;
  loadExtra?: () => Promise<unknown>;
  onAfterReset?: () => Promise<unknown>;
  onAfterSave?: () => Promise<unknown>;
  awaitEmbeddingRebuildOnSave?: boolean;
}

interface UseSettingsFlowResult {
  data: SettingsData | null;
  draft: Record<string, unknown>;
  loading: boolean;
  saving: boolean;
  rebuilding: boolean;
  error: string | null;
  dirtyKeys: string[];
  embeddingChanged: boolean;
  load: () => Promise<void>;
  clearDraft: () => void;
  handleChange: (key: string, newValue: unknown) => void;
  handleReset: (key: string) => Promise<void>;
  handleRebuild: (showToast?: boolean) => Promise<void>;
  handleSave: () => Promise<void>;
}

export function useSettingsFlow({
  t,
  confirmDialog,
  notify,
  loadExtra,
  onAfterReset,
  onAfterSave,
  awaitEmbeddingRebuildOnSave = false,
}: UseSettingsFlowArgs): UseSettingsFlowResult {
  const [data, setData] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tasks: Promise<unknown>[] = [api.get('/settings')];
      if (loadExtra) tasks.push(loadExtra());
      const [settingsResponse] = await Promise.all(tasks);
      setData((settingsResponse as { data: SettingsData }).data);
      setDraft({});
    } catch (e) {
      const axiosErr = e as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || t('Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [loadExtra, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirtyKeys = useMemo(() => Object.keys(draft), [draft]);

  const embeddingChanged = useMemo(
    () => dirtyKeys.some((key) => EMBEDDING_REBUILD_KEYS.has(key)),
    [dirtyKeys],
  );

  const clearDraft = useCallback(() => {
    setDraft({});
  }, []);

  const handleChange = useCallback((key: string, newValue: unknown) => {
    setDraft((prev) => {
      if (!data) return prev;
      const current = data.values[key];
      if (newValue === current || (newValue === '' && current === '')) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: newValue };
    });
  }, [data]);

  const handleReset = useCallback(async (key: string) => {
    setSaving(true);
    setError(null);
    try {
      const response = await api.post('/settings/reset', { keys: [key] });
      setData(response.data as SettingsData);
      setDraft((prev) => {
        const { [key]: _, ...rest } = prev;
        return rest;
      });
      if (onAfterReset) await onAfterReset();
      notify(`Reset ${key}`, 'success');
    } catch (e) {
      const axiosErr = e as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || 'Reset failed');
    } finally {
      setSaving(false);
    }
  }, [notify, onAfterReset]);

  const handleRebuild = useCallback(async (showToast = true) => {
    setRebuilding(true);
    setError(null);
    try {
      const response = await api.post('/browse/recall/rebuild');
      const payload = response.data as Record<string, unknown>;
      if (showToast) {
        notify(
          `${t('Rebuild completed')} (views: ${payload.updated_count ?? 0}, glossary: ${payload.glossary_embedding_updated_count ?? 0})`,
          'success',
        );
      }
    } catch (e) {
      const axiosErr = e as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || 'Rebuild failed');
    } finally {
      setRebuilding(false);
    }
  }, [notify, t]);

  const handleSave = useCallback(async () => {
    if (!dirtyKeys.length) return;
    if (embeddingChanged) {
      const ok = await confirmDialog({
        message: t('Changing the embedding model will invalidate all existing embeddings and trigger a full rebuild. Continue?'),
        confirmLabel: t('Continue'),
      });
      if (!ok) return;
    }

    setSaving(true);
    setError(null);
    try {
      const patch = Object.fromEntries(dirtyKeys.map((key) => [key, draft[key]]));
      const response = await api.put('/settings', { patch });
      setData(response.data as SettingsData);
      setDraft({});
      if (embeddingChanged && awaitEmbeddingRebuildOnSave) {
        await handleRebuild(false);
      }
      if (onAfterSave) await onAfterSave();
      notify(`Saved ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}`, 'success');
      if (embeddingChanged && !awaitEmbeddingRebuildOnSave) {
        void handleRebuild();
      }
    } catch (e) {
      const axiosErr = e as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [awaitEmbeddingRebuildOnSave, confirmDialog, dirtyKeys, draft, embeddingChanged, handleRebuild, notify, onAfterSave, t]);

  return {
    data,
    draft,
    loading,
    saving,
    rebuilding,
    error,
    dirtyKeys,
    embeddingChanged,
    load,
    clearDraft,
    handleChange,
    handleReset,
    handleRebuild,
    handleSave,
  };
}

'use client';

import React, { useCallback, useState } from 'react';
import type { AxiosError } from 'axios';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { SettingsData } from './SettingsSectionEditor';

export type SettingsConnectionSectionId = 'embedding' | 'view_llm';

type NotifyFn = (message: string, type: 'success' | 'error') => void;

interface SettingsConnectionTestButtonProps {
  sectionId: SettingsConnectionSectionId;
  data: SettingsData;
  draft: Record<string, unknown>;
  disabled?: boolean;
  notify: NotifyFn;
}

export function buildSettingsConnectionTestPatch(
  sectionId: SettingsConnectionSectionId,
  data: SettingsData,
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const schema of data.schema) {
    if (schema.section !== sectionId) continue;
    const dirty = Object.prototype.hasOwnProperty.call(draft, schema.key);
    if (schema.secret && !dirty) continue;
    patch[schema.key] = dirty ? draft[schema.key] : data.values[schema.key];
  }
  return patch;
}

function successMessage(sectionId: SettingsConnectionSectionId, detail: unknown, t: (key: string) => string): string {
  const prefix = sectionId === 'embedding' ? t('Embedding connection OK') : t('View LLM connection OK');
  return detail ? `${prefix} · ${detail}` : prefix;
}

export function SettingsConnectionTestButton({
  sectionId,
  data,
  draft,
  disabled = false,
  notify,
}: SettingsConnectionTestButtonProps): React.JSX.Element {
  const { t } = useT();
  const [testing, setTesting] = useState(false);

  const handleTest = useCallback(async () => {
    setTesting(true);
    try {
      const response = await api.post('/settings/test', {
        section: sectionId,
        patch: buildSettingsConnectionTestPatch(sectionId, data, draft),
      });
      notify(successMessage(sectionId, (response.data as { detail?: unknown })?.detail, t), 'success');
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>;
      notify(axiosError.response?.data?.detail || axiosError.message, 'error');
    } finally {
      setTesting(false);
    }
  }, [data, draft, notify, sectionId, t]);

  return (
    <Button variant="secondary" onClick={() => void handleTest()} disabled={disabled || testing}>
      {testing ? t('Testing…') : t('Test connection')}
    </Button>
  );
}

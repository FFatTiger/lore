'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AxiosError } from 'axios';
import clsx from 'clsx';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { SettingsData } from './SettingsSectionEditor';

export type SettingsConnectionSectionId = 'embedding' | 'view_llm';

interface SettingsConnectionTestButtonProps {
  sectionId: SettingsConnectionSectionId;
  data: SettingsData;
  draft: Record<string, unknown>;
  disabled?: boolean;
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

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

export function SettingsConnectionTestButton({
  sectionId,
  data,
  draft,
  disabled = false,
}: SettingsConnectionTestButtonProps): React.JSX.Element {
  const { t } = useT();
  const [status, setStatus] = useState<TestStatus>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleTest = useCallback(async () => {
    clearTimeout(timerRef.current);
    setStatus('testing');
    setErrorText(null);
    try {
      const response = await api.post('/settings/test', {
        section: sectionId,
        patch: buildSettingsConnectionTestPatch(sectionId, data, draft),
      });
      const detail = (response.data as { detail?: unknown })?.detail;
      setErrorText(typeof detail === 'string' ? detail : null);
      setStatus('ok');
      timerRef.current = setTimeout(() => {
        setStatus('idle');
        setErrorText(null);
      }, 3000);
    } catch (error) {
      const axiosError = error as AxiosError<{ detail?: string }>;
      setErrorText(axiosError.response?.data?.detail || axiosError.message);
      setStatus('fail');
      timerRef.current = setTimeout(() => {
        setStatus('idle');
        setErrorText(null);
      }, 6000);
    }
  }, [data, draft, sectionId, t]);

  const label = status === 'testing' ? t('Testing…')
    : status === 'ok' ? (sectionId === 'embedding' ? t('Embedding OK') : t('View LLM OK'))
    : status === 'fail' ? t('Connection failed')
    : t('Test connection');

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        onClick={() => void handleTest()}
        disabled={disabled || status === 'testing'}
        className={clsx(
          status === 'ok' && '!border-green-500 !text-green-600',
          status === 'fail' && '!border-red-500 !text-red-500',
        )}
      >
        {status === 'ok' ? '✅ ' : status === 'fail' ? '❌ ' : ''}
        {label}
      </Button>
      {status === 'fail' && errorText && (
        <span className="text-xs text-red-500 max-w-[200px] truncate">{errorText}</span>
      )}
    </span>
  );
}

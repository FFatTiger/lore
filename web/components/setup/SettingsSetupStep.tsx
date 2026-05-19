'use client';

import React, { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowRight, Check, RefreshCw } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { Button, LoadingBlock, Notice, surfaceCardClassName } from '@/components/ui';
import {
  findSettingsSection,
  SettingsSectionEditor,
  type FieldSchema,
} from '@/components/settings/SettingsSectionEditor';
import { SettingsConnectionTestButton } from '@/components/settings/SettingsConnectionTestButton';
import { useSettingsFlow } from '@/components/settings/useSettingsFlow';
import { SetupBackButton, SetupFlowShell } from '@/components/setup/SetupFlowShell';
import { getSetupAdvanceTarget, isLastSetupStep, setupAdvanceLabel } from '@/components/setup/setupFlowActions';
import { useConfirm } from '@/components/ConfirmDialog';
import { getSetupFlowStatus } from '@/lib/api';
import { dispatchSetupStatusChanged, type SetupFlowStatus } from '@/lib/bootSetup';
import { useT } from '@/lib/i18n';

interface SettingsSetupStepProps {
  sectionId: 'embedding' | 'view_llm';
}

const SETUP_CONTROL_CLASS_NAME = 'min-h-12 py-3 text-[14px] [&_.ant-input-number-input]:h-12 [&_.ant-input-number-input]:text-[14px] [&_.ant-select-selector]:!min-h-12 [&_.ant-select-selector]:!items-center';
const SETUP_CONTROL_STYLE = { minHeight: 48 };

const SETUP_REQUIRED_SETTING_KEYS: Record<SettingsSetupStepProps['sectionId'], string[]> = {
  embedding: ['embedding.base_url', 'embedding.api_key', 'embedding.model'],
  view_llm: ['view_llm.base_url', 'view_llm.api_key', 'view_llm.model'],
};

function getStepMeta(sectionId: SettingsSetupStepProps['sectionId']) {
  if (sectionId === 'embedding') {
    return {
      stepId: 'embedding' as const,
      title: 'Embedding setup',
      description: 'Configure the vector endpoint Lore uses for embeddings before continuing. Example: http://127.0.0.1:8090/v1',
    };
  }
  return {
    stepId: 'llm' as const,
    title: 'View LLM setup',
    description: 'Configure the model Lore uses for view refinement and dream workflows. Example: http://127.0.0.1:8090/v1',
  };
}

function getPreviousStepPath(setupStatus: SetupFlowStatus | null, stepId: 'embedding' | 'llm'): string | null {
  if (!setupStatus) return null;
  const index = setupStatus.steps.findIndex((step) => step.id === stepId);
  if (index <= 0) return null;
  return setupStatus.steps[index - 1]?.path || null;
}

export default function SettingsSetupStep({ sectionId }: SettingsSetupStepProps): React.JSX.Element {
  const meta = getStepMeta(sectionId);
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname() || '';
  const { confirm: confirmDialog, toast } = useConfirm();
  const [setupStatus, setSetupStatus] = useState<SetupFlowStatus | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const refreshSetupOnly = useCallback(async (): Promise<SetupFlowStatus | null> => {
    try {
      const next = await getSetupFlowStatus();
      setSetupStatus(next);
      return next;
    } catch (e) {
      throw e;
    }
  }, []);

  const goAdvance = useCallback((nextSetupStatus: SetupFlowStatus | null) => {
    const target = getSetupAdvanceTarget(nextSetupStatus, meta.stepId);
    if (target !== pathname) router.replace(target);
  }, [meta.stepId, pathname, router]);

  const {
    data,
    draft,
    loading,
    saving,
    rebuilding,
    error,
    dirtyKeys,
    handleChange,
    handleReset,
    handleSave,
  } = useSettingsFlow({
    t,
    confirmDialog,
    notify: toast,
    loadExtra: refreshSetupOnly,
    onAfterReset: async () => {
      await refreshSetupOnly();
      dispatchSetupStatusChanged();
    },
    onAfterSave: async () => {
      const nextSetupStatus = await refreshSetupOnly();
      dispatchSetupStatusChanged();
      goAdvance(nextSetupStatus);
    },
    awaitEmbeddingRebuildOnSave: true,
    skipEmbeddingRebuildWhenUnconfigured: sectionId === 'embedding',
  });

  const section = useMemo(() => findSettingsSection(data, sectionId), [data, sectionId]);
  const previousPath = useMemo(() => getPreviousStepPath(setupStatus, meta.stepId), [meta.stepId, setupStatus]);
  const isLastStep = useMemo(() => isLastSetupStep(setupStatus, meta.stepId), [meta.stepId, setupStatus]);
  const advanceLabel = setupAdvanceLabel(setupStatus, meta.stepId, t);

  const isFieldFilled = useCallback((schema: FieldSchema): boolean => {
    const effectiveValue = schema.key in draft ? draft[schema.key] : data?.values[schema.key];
    if (schema.secret && data?.secret_configured[schema.key] === true && !(schema.key in draft)) return true;
    return String(effectiveValue ?? '').trim().length > 0;
  }, [data, draft]);

  const findMissingRequiredFields = useCallback((): FieldSchema[] => {
    if (!section) return [];
    const required = new Set(SETUP_REQUIRED_SETTING_KEYS[sectionId]);
    return section.items.filter((schema) => required.has(schema.key) && !isFieldFilled(schema));
  }, [isFieldFilled, section, sectionId]);

  const handleAdvance = useCallback(async () => {
    setValidationError(null);
    const missing = findMissingRequiredFields();
    if (missing.length > 0) {
      setValidationError(`${t('Fill every field on this page before continuing.')} ${missing.map((field) => field.label).join(', ')}`);
      return;
    }
    if (dirtyKeys.length > 0) {
      await handleSave();
      return;
    }
    const nextSetupStatus = await refreshSetupOnly();
    dispatchSetupStatusChanged();
    goAdvance(nextSetupStatus);
  }, [dirtyKeys.length, findMissingRequiredFields, goAdvance, handleSave, refreshSetupOnly, t]);

  const topNotice = useMemo(() => {
    if (!setupStatus) return null;
    if (sectionId === 'view_llm' && setupStatus.llm.configured && !setupStatus.llm.runtime_ready) {
      return (
        <Notice tone="warning" title={t('Runtime not ready')}>
          <div className="space-y-2">
            <p>{t('View LLM settings are incomplete. Draft generation and dream workflows stay disabled until base URL, API key, and model are all configured in Settings.')}</p>
            {setupStatus.boot.draft_generation_reason && <p>{setupStatus.boot.draft_generation_reason}</p>}
          </div>
        </Notice>
      );
    }
    return null;
  }, [sectionId, setupStatus, t]);

  return (
    <SetupFlowShell
      stepId={meta.stepId}
      setupStatus={setupStatus}
      title={t(meta.title)}
      description={t(meta.description)}
      topNotice={topNotice}
      right={
        <>
          {previousPath ? <SetupBackButton href={previousPath} /> : null}
          <Button variant="primary" onClick={() => void handleAdvance()} disabled={saving || rebuilding || loading || !section}>
            {saving || rebuilding ? <RefreshCw size={14} className="animate-spin" /> : isLastStep ? <Check size={14} /> : <ArrowRight size={14} />}
            {saving || rebuilding ? t('Saving…') : advanceLabel}
          </Button>
        </>
      }
    >
      {error && (
        <Notice tone="danger" title={t('Failed to load')}>
          {error}
        </Notice>
      )}

      {validationError && (
        <Notice tone="danger" title={t('Required fields missing')}>
          {validationError}
        </Notice>
      )}

      {loading && <LoadingBlock />}

      {!loading && !section && (
        <Notice tone="danger" title={t('Not found')}>
          {sectionId}
        </Notice>
      )}

      {!loading && section && data && (
        <div className={clsx('animate-in stagger-2 overflow-hidden', surfaceCardClassName)}>
          <div className="flex justify-end border-b border-separator-thin px-4 md:px-6 py-3">
            <SettingsConnectionTestButton
              sectionId={sectionId}
              data={data}
              draft={draft}
              disabled={saving || rebuilding}
              notify={toast}
            />
          </div>
          <SettingsSectionEditor
            section={section}
            data={data}
            draft={draft}
            saving={saving || rebuilding}
            onChange={handleChange}
            onReset={(key) => void handleReset(key)}
            controlClassName={SETUP_CONTROL_CLASS_NAME}
            controlStyle={SETUP_CONTROL_STYLE}
            hideHeader
          />
        </div>
      )}
    </SetupFlowShell>
  );
}

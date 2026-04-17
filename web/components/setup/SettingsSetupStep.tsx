'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button, Card, Notice } from '@/components/ui';
import {
  buildSettingsSaveLabel,
  findSettingsSection,
  SettingsSectionEditor,
} from '@/components/settings/SettingsSectionEditor';
import { useSettingsFlow } from '@/components/settings/useSettingsFlow';
import { SetupBackButton, SetupFlowShell } from '@/components/setup/SetupFlowShell';
import { useConfirm } from '@/components/ConfirmDialog';
import { getSetupFlowStatus } from '@/lib/api';
import { dispatchSetupStatusChanged, type SetupFlowStatus } from '@/lib/bootSetup';
import { useT } from '@/lib/i18n';

interface SettingsSetupStepProps {
  sectionId: 'embedding' | 'view_llm';
}

function getStepMeta(sectionId: SettingsSetupStepProps['sectionId']) {
  if (sectionId === 'embedding') {
    return {
      stepId: 'embedding' as const,
      title: 'Embedding setup',
      description: 'Configure the vector endpoint Lore uses for embeddings before continuing.',
    };
  }
  return {
    stepId: 'llm' as const,
    title: 'View LLM setup',
    description: 'Configure the model Lore uses for draft generation, view refinement, and dream workflows.',
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

  const refreshSetupOnly = useCallback(async (): Promise<SetupFlowStatus | null> => {
    try {
      const next = await getSetupFlowStatus();
      setSetupStatus(next);
      return next;
    } catch (e) {
      throw e;
    }
  }, []);

  const {
    data,
    draft,
    loading,
    saving,
    rebuilding,
    error,
    dirtyKeys,
    clearDraft,
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
      const target = nextSetupStatus?.next_step || '/memory';
      if (target !== pathname) router.replace(target);
    },
    awaitEmbeddingRebuildOnSave: true,
  });

  const section = useMemo(() => findSettingsSection(data, sectionId), [data, sectionId]);
  const previousPath = useMemo(() => getPreviousStepPath(setupStatus, meta.stepId), [meta.stepId, setupStatus]);

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

  const footer = previousPath ? <SetupBackButton href={previousPath} /> : <div />;

  return (
    <SetupFlowShell
      stepId={meta.stepId}
      setupStatus={setupStatus}
      title={t(meta.title)}
      description={t(meta.description)}
      topNotice={topNotice}
      footer={footer}
    >
      {error && (
        <Notice tone="danger" title={t('Failed to load')}>
          {error}
        </Notice>
      )}

      {loading && (
        <div className="flex justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-fill-tertiary border-t-sys-blue" />
        </div>
      )}

      {!loading && !section && (
        <Notice tone="danger" title={t('Not found')}>
          {sectionId}
        </Notice>
      )}

      {!loading && section && data && (
        <Card className="overflow-hidden p-0">
          <SettingsSectionEditor
            section={section}
            data={data}
            draft={draft}
            saving={saving || rebuilding}
            onChange={handleChange}
            onReset={(key) => void handleReset(key)}
            right={
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {dirtyKeys.length > 0 && (
                  <Button variant="ghost" onClick={clearDraft} disabled={saving || rebuilding}>
                    {t('Discard')}
                  </Button>
                )}
                <Button variant="primary" onClick={() => void handleSave()} disabled={saving || rebuilding || dirtyKeys.length === 0}>
                  {saving || rebuilding ? t('Saving…') : buildSettingsSaveLabel(dirtyKeys.length, t)}
                </Button>
              </div>
            }
          />
        </Card>
      )}
    </SetupFlowShell>
  );
}

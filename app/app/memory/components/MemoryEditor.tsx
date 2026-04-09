import React, { ChangeEvent } from 'react';
import { Button } from '../../../components/ui';
import { useT } from '../../../lib/i18n';

interface MemoryEditorProps {
  editContent: string;
  setEditContent: (value: string) => void;
  editDisclosure: string;
  setEditDisclosure: (value: string) => void;
  editPriority: number;
  setEditPriority: (value: number) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export default function MemoryEditor({
  editContent, setEditContent,
  editDisclosure, setEditDisclosure,
  editPriority, setEditPriority,
  saving, onSave, onCancel,
}: MemoryEditorProps): React.JSX.Element {
  const { t } = useT();
  return (
    <div className="mb-8 rounded-2xl border border-sys-blue/30 bg-sys-blue/[0.04] p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-sys-blue">{t('Editing')}</h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>{t('Cancel')}</Button>
          <Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
            {saving ? t('Saving…') : t('Save')}
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr] items-start">
        <label className="block">
          <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Priority')}</span>
          <input
            type="number" min="0" value={editPriority}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEditPriority(parseInt(e.target.value, 10) || 0)}
            className="w-24 rounded-lg border border-separator-thin bg-bg-raised px-3 py-2 font-mono text-[14px] tabular-nums text-txt-primary focus:border-sys-blue/60 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Disclosure')}</span>
          <input
            type="text" value={editDisclosure}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEditDisclosure(e.target.value)}
            placeholder={t('When should this memory be recalled?')}
            className="w-full rounded-lg border border-separator-thin bg-bg-raised px-3 py-2 text-[14px] text-txt-primary placeholder:text-txt-quaternary focus:border-sys-blue/60 focus:outline-none"
          />
        </label>
      </div>
      <textarea
        value={editContent}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEditContent(e.target.value)}
        className="h-80 w-full resize-y rounded-xl border border-separator-thin bg-bg-raised p-4 text-[15px] leading-relaxed text-txt-primary focus:border-sys-blue/60 focus:outline-none"
        spellCheck={false}
      />
    </div>
  );
}

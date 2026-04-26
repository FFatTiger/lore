import React, { useState, ChangeEvent } from 'react';
import { AppInput, AppTextArea, Button } from '../../../components/ui';
import { useT } from '../../../lib/i18n';
import { api } from '../../../lib/api';
import { AxiosError } from 'axios';

interface CreateNodeFormProps {
  domain: string;
  parentPath: string;
  onCreated: () => void;
  onCancel: () => void;
}

export default function CreateNodeForm({ domain, parentPath, onCreated, onCancel }: CreateNodeFormProps): React.JSX.Element {
  const { t } = useT();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState(2);
  const [disclosure, setDisclosure] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true); setError(null);
    try {
      await api.post('/browse/node', {
        domain,
        parent_path: parentPath,
        title: title.trim(),
        content,
        priority,
        disclosure: disclosure || null,
      });
      onCreated();
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || t('Create failed'));
    } finally { setSaving(false); }
  };

  return (
    <div className="mb-6 rounded-2xl border border-sys-green/30 bg-sys-green/[0.04] p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-sys-green">{t('New Child Node')}</h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>{t('Cancel')}</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !title.trim()}>
            {saving ? t('Creating…') : t('Create')}
          </Button>
        </div>
      </div>
      {error && <p className="text-[13px] text-sys-red">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] items-start">
        <label className="block">
          <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Title')} ({t('Path segment')})</span>
          <AppInput
            type="text" value={title}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            placeholder="snake_case_name"
            className="font-mono text-[14px]"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Priority')}</span>
          <AppInput
            type="number" min="0" value={priority}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPriority(parseInt(e.target.value, 10) || 0)}
            className="w-24 font-mono text-[14px] tabular-nums"
          />
        </label>
      </div>
      <label className="block">
        <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Disclosure')}</span>
        <AppInput
          type="text" value={disclosure}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDisclosure(e.target.value)}
          placeholder={t('When should this memory be recalled?')}
          className="text-[14px]"
        />
      </label>
      <AppTextArea
        value={content}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)}
        placeholder={t('Memory content…')}
        className="h-40 text-[15px] leading-relaxed"
        spellCheck={false}
      />
      <p className="text-[11px] text-txt-quaternary">
        {t('Will create')}: <code className="font-mono">{domain}://{parentPath ? `${parentPath}/` : ''}{title || '…'}</code>
      </p>
    </div>
  );
}

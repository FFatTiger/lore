import React, { useState, ChangeEvent } from 'react';
import { Button } from '../../../components/ui';
import { useT } from '../../../lib/i18n';
import { api } from '../../../lib/api';
import { AxiosError } from 'axios';

interface MoveDialogProps {
  domain: string;
  path: string;
  onMoved: (newDomain: string, newPath: string) => void;
  onCancel: () => void;
}

export default function MoveDialog({ domain, path, onMoved, onCancel }: MoveDialogProps): React.JSX.Element {
  const { t } = useT();
  const currentUri = `${domain}://${path}`;
  const [newUri, setNewUri] = useState(currentUri);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const trimmed = newUri.trim();
    if (!trimmed || trimmed === currentUri) { onCancel(); return; }
    setSaving(true); setError(null);
    try {
      await api.post('/browse/move', { old_uri: currentUri, new_uri: trimmed });
      const match = trimmed.match(/^([^:]+):\/\/(.*)$/);
      if (match) {
        onMoved(match[1], match[2]);
      } else {
        onMoved(domain, trimmed);
      }
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setError(axiosErr.response?.data?.detail || axiosErr.message || 'Move failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="mb-8 rounded-2xl border border-sys-orange/30 bg-sys-orange/[0.04] p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-sys-orange">{t('Move / Rename')}</h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>{t('Cancel')}</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !newUri.trim()}>
            {saving ? t('Moving…') : t('Move')}
          </Button>
        </div>
      </div>
      {error && <p className="text-[13px] text-sys-red">{error}</p>}
      <label className="block">
        <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('New URI')}</span>
        <input
          type="text" value={newUri}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNewUri(e.target.value)}
          placeholder="domain://path/to/node"
          className="w-full rounded-lg border border-separator-thin bg-bg-raised px-3 py-2 font-mono text-[14px] text-txt-primary focus:border-sys-orange/60 focus:outline-none"
          autoFocus
        />
      </label>
      <p className="text-[11px] text-txt-quaternary">{t('Child nodes will follow automatically.')}</p>
    </div>
  );
}

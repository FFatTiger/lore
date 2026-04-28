'use client';

import React, { useState, useEffect, useRef, KeyboardEvent, ChangeEvent } from 'react';
import type { InputRef } from 'antd';
import { X } from 'lucide-react';
import { AppInput } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useT } from '../../../lib/i18n';
import { useConfirm } from '../../../components/ConfirmDialog';
import { AxiosError } from 'axios';

interface KeywordManagerProps {
  keywords: string[];
  nodeUuid: string;
  onUpdate: () => void;
}

const KeywordManager = ({ keywords, nodeUuid, onUpdate }: KeywordManagerProps): React.JSX.Element => {
  const { t } = useT();
  const { toast } = useConfirm();
  const [adding, setAdding] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<InputRef>(null);
  const visibleKeywords = expanded ? keywords : keywords.slice(0, 3);
  const hiddenCount = Math.max(0, keywords.length - visibleKeywords.length);

  useEffect(() => { if (adding && inputRef.current) inputRef.current.focus(); }, [adding]);

  const handleAdd = async () => {
    const kw = newKeyword.trim();
    if (!kw || !nodeUuid) return;
    try {
      await api.post('/browse/glossary', { keyword: kw, node_uuid: nodeUuid });
      setNewKeyword(''); setAdding(false); onUpdate();
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      toast(axiosErr.response?.data?.detail || axiosErr.message || t('Failed'));
    }
  };

  const handleRemove = async (kw: string) => {
    if (!nodeUuid) return;
    try {
      await api.delete('/browse/glossary', { data: { keyword: kw, node_uuid: nodeUuid } });
      onUpdate();
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      toast(axiosErr.response?.data?.detail || axiosErr.message || t('Failed'));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleAdd();
    if (e.key === 'Escape') { setAdding(false); setNewKeyword(''); }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Glossary')}</span>
      {visibleKeywords.map((kw) => (
        <span key={kw} className="inline-flex items-center gap-0.5 font-mono text-[10.5px] text-txt-tertiary">
          #{kw}
          <button onClick={() => handleRemove(kw)} className="opacity-35 hover:opacity-100" aria-label={t('Remove')}>
            <X size={9} />
          </button>
        </span>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="font-mono text-[10.5px] text-txt-quaternary hover:text-sys-blue"
        >
          +{hiddenCount}
        </button>
      )}
      {adding ? (
        <AppInput
          ref={inputRef} type="text" value={newKeyword}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNewKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (!newKeyword.trim()) setAdding(false); }}
          placeholder={t('keyword')}
          className="w-28 font-mono text-[11px]"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="rounded-md border border-dashed border-separator-thin px-1.5 py-[1px] text-[10.5px] text-txt-quaternary transition-colors hover:border-sys-blue/40 hover:text-sys-blue"
        >
          + {t('Add')}
        </button>
      )}
    </div>
  );
};

export default KeywordManager;

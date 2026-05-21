'use client';

import React, { useState, useEffect, useRef, KeyboardEvent, ChangeEvent } from 'react';
import type { InputRef } from 'antd';
import { X } from 'lucide-react';
import { ActionIcon, AppInput, Badge, TextButton } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useT } from '../../../lib/i18n';
import { useConfirm } from '../../../components/ConfirmDialog';
import { AxiosError } from 'axios';

interface KeywordManagerProps {
  keywords: string[];
  domain: string;
  path: string;
  onUpdate: () => void;
  variant?: 'default' | 'subtitle';
}

const KeywordManager = ({ keywords, domain, path, onUpdate, variant = 'default' }: KeywordManagerProps): React.JSX.Element => {
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
    if (!kw || !path) return;
    try {
      await api.put('/browse/node', { glossary_add: [kw] }, { params: { domain, path } });
      setNewKeyword(''); setAdding(false); onUpdate();
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      toast(axiosErr.response?.data?.detail || axiosErr.message || t('Failed'));
    }
  };

  const handleRemove = async (kw: string) => {
    if (!path) return;
    try {
      await api.put('/browse/node', { glossary_remove: [kw] }, { params: { domain, path } });
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

  if (variant === 'subtitle') {
    return (
      <div className="inline-flex min-w-0 flex-wrap items-center gap-1.5" data-memory-keywords="true">
        <span className="shrink-0 text-txt-tertiary">{t('Glossary')}:</span>
        {visibleKeywords.map((kw) => (
          <span key={kw} className="inline-flex items-center gap-1 rounded-md bg-fill-quaternary px-1.5 py-0.5 font-mono text-[12px] text-txt-secondary">
            <span>#{kw}</span>
            <ActionIcon icon={X} title={t('Remove')} size="small" onClick={() => void handleRemove(kw)} />
          </span>
        ))}
        {hiddenCount > 0 && (
          <TextButton type="button" size="sm" tone="default" onClick={() => setExpanded(true)}>
            +{hiddenCount}
          </TextButton>
        )}
        {adding ? (
          <AppInput
            ref={inputRef} type="text" value={newKeyword}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => { if (!newKeyword.trim()) setAdding(false); }}
            placeholder={t('keyword')}
            className="w-28"
            size="sm"
            mono
          />
        ) : (
          <TextButton type="button" size="sm" tone="default" onClick={() => setAdding(true)}>
            + {t('Add')}
          </TextButton>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Glossary')}</span>
      {visibleKeywords.map((kw) => (
        <Badge key={kw} size="sm" tone="soft" mono className="gap-1 pr-1">
          <span>#{kw}</span>
          <ActionIcon icon={X} title={t('Remove')} size="small" onClick={() => void handleRemove(kw)} />
        </Badge>
      ))}
      {hiddenCount > 0 && (
        <TextButton type="button" size="sm" tone="default" onClick={() => setExpanded(true)}>
          +{hiddenCount}
        </TextButton>
      )}
      {adding ? (
        <AppInput
          ref={inputRef} type="text" value={newKeyword}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNewKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (!newKeyword.trim()) setAdding(false); }}
          placeholder={t('keyword')}
          className="w-28"
          size="sm"
          mono
        />
      ) : (
        <TextButton type="button" size="sm" tone="default" onClick={() => setAdding(true)}>
          + {t('Add')}
        </TextButton>
      )}
    </div>
  );
};

export default KeywordManager;

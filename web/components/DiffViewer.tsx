'use client';

import React from 'react';
import { diffLines, Change } from 'diff';
import { useT } from '../lib/i18n';

interface DiffViewerProps {
  oldText: string;
  newText: string;
  noChangesHint?: string;
}

const DiffViewer = ({ oldText, newText, noChangesHint }: DiffViewerProps): React.JSX.Element => {
  const { t } = useT();
  const diff: Change[] = diffLines(oldText || '', newText || '');
  const hasChanges = (oldText || '') !== (newText || '');

  return (
    <div className="w-full font-mono text-[12px] leading-relaxed">
      {!hasChanges && (
        <p className="py-3 text-center text-[13px] text-txt-tertiary">
          {noChangesHint || t('No textual changes.')}
        </p>
      )}
      <div className="space-y-0.5">
        {diff.map((part, i) => {
          if (part.removed) return (
            <div key={i} className="rounded-md bg-sys-red/[0.08] pl-4 pr-3 py-1 select-text">
              <span className="text-sys-red whitespace-pre-wrap">
                <span className="text-sys-red/50 select-none mr-1">−</span>{part.value}
              </span>
            </div>
          );
          if (part.added) return (
            <div key={i} className="rounded-md bg-sys-green/[0.08] pl-4 pr-3 py-1 select-text">
              <span className="text-sys-green whitespace-pre-wrap">
                <span className="text-sys-green/50 select-none mr-1">+</span>{part.value}
              </span>
            </div>
          );
          return (
            <div key={i} className="pl-4 pr-3 py-1 text-txt-tertiary whitespace-pre-wrap">
              <span className="select-none mr-1 opacity-0">·</span>{part.value}
            </div>
          );
        })}
      </div>
    </div>
  );
};
export default DiffViewer;

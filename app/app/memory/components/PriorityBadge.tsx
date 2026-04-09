'use client';

import React from 'react';
import clsx from 'clsx';

interface PriorityBadgeProps {
  priority: number | null | undefined;
  size?: 'sm' | 'lg';
}

const PriorityBadge = ({ priority, size = 'sm' }: PriorityBadgeProps): React.JSX.Element | null => {
  if (priority === null || priority === undefined) return null;

  const tone =
    priority === 0 ? 'bg-sys-red/15 text-sys-red'
    : priority <= 2 ? 'bg-sys-orange/15 text-sys-orange'
    : priority <= 5 ? 'bg-sys-teal/15 text-sys-teal'
    : 'bg-fill-tertiary text-txt-tertiary';

  return (
    <span className={clsx(
      'inline-flex items-center gap-1 rounded-md font-mono tabular-nums',
      tone,
      size === 'lg' ? 'px-2 py-0.5 text-[11px]' : 'px-1.5 py-0.5 text-[10px]',
    )}>
      <span className="opacity-70">P</span>{priority}
    </span>
  );
};

export default PriorityBadge;

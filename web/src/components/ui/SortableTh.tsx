import React from 'react';
import type { SortDir } from '@/lib/useSortableTable.js';

export interface SortableThProps {
  label: string;
  sortKey?: string;
  activeKey: string | null;
  activeDir: SortDir | null;
  onSort?: (key: string) => void;
  align?: 'left' | 'right';
  className?: string;
}

export const SortableTh: React.FC<SortableThProps> = ({
  label,
  sortKey,
  activeKey,
  activeDir,
  onSort,
  align = 'left',
  className = '',
}) => {
  const sortable = !!sortKey && !!onSort;
  const isActive = sortable && activeKey === sortKey;
  const indicator = isActive ? (activeDir === 'asc' ? '↑' : '↓') : sortable ? '↕' : '';
  const justify = align === 'right' ? 'justify-end' : 'justify-start';
  const ariaSort = !sortable
    ? undefined
    : isActive
      ? activeDir === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none';

  return (
    <th
      className={`py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
      aria-sort={ariaSort}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort!(sortKey!)}
          className={`inline-flex items-center gap-1 ${justify} w-full select-none uppercase tracking-wider text-[10.5px] font-semibold ${isActive ? 'text-neutral-700' : 'text-neutral-500'} hover:text-neutral-900`}
        >
          <span>{label}</span>
          <span
            aria-hidden
            className={`text-[10px] leading-none ${isActive ? 'text-neutral-700' : 'text-neutral-300'}`}
          >
            {indicator}
          </span>
        </button>
      ) : (
        <span
          className={`inline-flex ${justify} w-full uppercase tracking-wider text-[10.5px] font-semibold text-neutral-500`}
        >
          {label}
        </span>
      )}
    </th>
  );
};

'use client';

import React, { type ReactNode, useMemo } from 'react';
import clsx from 'clsx';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { EmptyState } from './controls';

type RowData = Record<string, unknown>;

export interface TableColumn<T extends RowData = RowData> {
  key: string;
  label: ReactNode;
  className?: string;
  render?: (value: T[string], row: T) => ReactNode;
}

function resolveRowIdentity(row: RowData): string {
  for (const value of [row.uri, row.node_uri, row.query_id, row.id]) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function rowKey(row: RowData, index: number): string {
  const primary = resolveRowIdentity(row);
  const suffix = String(row.view_type || row.keyword || row.retrieval_path || '');
  return `${index}-${primary}-${suffix}`;
}

interface TableProps<T extends RowData = RowData> {
  columns: TableColumn<T>[];
  rows?: T[] | null;
  empty?: string;
  onRowClick?: (row: T) => void;
  activeRowKey?: string;
}

export function Table<T extends RowData = RowData>({ columns, rows, empty = '暂无数据', onRowClick, activeRowKey }: TableProps<T>): React.JSX.Element {
  const data = useMemo(() => rows || [], [rows]);
  const tableColumns = useMemo(() => columns.map((col) => ({
    id: col.key,
    accessorFn: (row: T) => row[col.key],
    header: () => col.label,
    cell: ({ row }: { row: { original: T } }) => (col.render ? col.render(row.original[col.key] as T[string], row.original) : String(row.original[col.key] ?? '—')),
    meta: { className: col.className },
  })), [columns]);
  const table = useReactTable({ data, columns: tableColumns, getCoreRowModel: getCoreRowModel() });
  if (!data.length) return <EmptyState text={empty} />;
  return (
    <div className="w-full overflow-x-auto">
      <table className="min-w-full border-collapse text-left">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-separator-thin">
              {headerGroup.headers.map((header) => (
                <th key={header.id} className={clsx('px-0 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary align-middle first:pr-4 last:pl-4', (header.column.columnDef.meta as { className?: string } | undefined)?.className)}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, i) => {
            const original = row.original as T & RowData;
            const key = rowKey(original, i);
            const active = Boolean(activeRowKey) && activeRowKey === resolveRowIdentity(original);
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={clsx(
                  'border-b border-separator-thin last:border-b-0 align-top transition-colors duration-150',
                  active ? 'bg-sys-blue/[0.08]' : onRowClick && 'hover:bg-fill-primary/50',
                  onRowClick && 'cursor-pointer',
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={clsx('px-0 py-3 text-[13px] text-txt-primary first:pr-4 last:pl-4', (cell.column.columnDef.meta as { className?: string } | undefined)?.className)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

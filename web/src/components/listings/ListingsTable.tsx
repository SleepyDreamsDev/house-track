import React from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { SortableTh } from '@/components/ui/SortableTh.js';
import { fmt } from '@/lib/format.js';
import { useSortableTable, type Accessors, type SortState } from '@/lib/useSortableTable.js';

export interface ListingsTableRow {
  id: string;
  url: string;
  title: string;
  district: string | null;
  priceEur: number | null;
  priceWas?: number;
  areaSqm: number | null;
  rooms: number | null;
  yearBuilt?: number;
  firstSeenAt: string;
  isNew?: boolean;
}

const accessors: Accessors<ListingsTableRow> = {
  title: (r) => r.title,
  district: (r) => r.district,
  priceEur: (r) => r.priceEur,
  eurPerSqm: (r) => (r.areaSqm && r.priceEur ? Math.round(r.priceEur / r.areaSqm) : null),
  areaSqm: (r) => r.areaSqm,
  rooms: (r) => r.rooms,
  yearBuilt: (r) => r.yearBuilt ?? null,
  firstSeenAt: (r) => new Date(r.firstSeenAt).getTime(),
};

export interface ListingsTableProps {
  rows: ListingsTableRow[];
  defaultSort?: SortState | null;
  onRowClick?: (r: ListingsTableRow) => void;
  selectedId?: string | null;
}

export const ListingsTable: React.FC<ListingsTableProps> = ({
  rows,
  defaultSort = { key: 'firstSeenAt', dir: 'desc' },
  onRowClick,
  selectedId,
}) => {
  const { sortedRows, sortKey, sortDir, requestSort } = useSortableTable({
    rows,
    accessors,
    initial: defaultSort,
  });

  return (
    <div className="rounded-sm border border-neutral-200 bg-white overflow-hidden">
      <table className="w-full text-[12.5px]" data-testid="listings-table">
        <thead>
          <tr className="border-b border-neutral-200">
            <SortableTh
              label="Title"
              sortKey="title"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              className="px-3"
            />
            <SortableTh
              label="District"
              sortKey="district"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              className="px-3"
            />
            <SortableTh
              label="Price"
              sortKey="priceEur"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              align="right"
              className="px-3"
            />
            <SortableTh
              label="€/m²"
              sortKey="eurPerSqm"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              align="right"
              className="px-3"
            />
            <SortableTh
              label="Area"
              sortKey="areaSqm"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              align="right"
              className="px-3"
            />
            <SortableTh
              label="Rooms"
              sortKey="rooms"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              align="right"
              className="px-3"
            />
            <SortableTh
              label="Year"
              sortKey="yearBuilt"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              align="right"
              className="px-3"
            />
            <SortableTh
              label="First seen"
              sortKey="firstSeenAt"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              align="right"
              className="px-3"
            />
            <th className="py-2 w-12 px-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {sortedRows.map((r) => {
            const drop =
              r.priceWas && r.priceEur ? Math.round((1 - r.priceEur / r.priceWas) * 100) : null;
            const eurm2 = r.areaSqm && r.priceEur ? Math.round(r.priceEur / r.areaSqm) : null;
            const isSelected = selectedId === r.id;
            return (
              <tr
                key={r.id}
                data-listing-id={r.id}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`hover:bg-neutral-50 ${onRowClick ? 'cursor-pointer' : ''} ${isSelected ? 'bg-accent/5' : ''}`}
              >
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {r.isNew && <Badge variant="default">NEW</Badge>}
                    {drop !== null && drop > 0 && <Badge variant="warning">−{drop}%</Badge>}
                    <span className="truncate font-medium text-neutral-800" title={r.title}>
                      {r.title}
                    </span>
                  </div>
                </td>
                <td className="py-2 px-3 text-neutral-600">{r.district ?? '—'}</td>
                <td className="py-2 px-3 text-right tabular-nums font-medium">
                  {fmt.eur(r.priceEur)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-neutral-600">
                  {eurm2 !== null ? `€${eurm2}` : '—'}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-neutral-600">
                  {r.areaSqm !== null ? `${r.areaSqm} m²` : '—'}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-neutral-600">
                  {r.rooms ?? '—'}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-neutral-500">
                  {r.yearBuilt ?? '—'}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-neutral-500">
                  {fmt.rel(r.firstSeenAt)}
                </td>
                <td className="py-2 px-3 text-right">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-sm border border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    Open ↗
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

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
  landAre?: number | null;
  rooms: number | null;
  firstSeenAt: string;
  isNew?: boolean;
  watchlist?: boolean;
  excluded?: boolean;
  derivedType?: 'House' | 'Villa' | 'Townhouse' | 'Duplex';
  typeMismatch?: boolean;
  regionMismatch?: boolean;
  mismatchReasons?: string[];
}

const accessors: Accessors<ListingsTableRow> = {
  title: (r) => r.title,
  district: (r) => r.district,
  priceEur: (r) => r.priceEur,
  eurPerSqm: (r) => (r.areaSqm && r.priceEur ? Math.round(r.priceEur / r.areaSqm) : null),
  areaSqm: (r) => r.areaSqm,
  landAre: (r) => r.landAre ?? null,
  rooms: (r) => r.rooms,
  firstSeenAt: (r) => new Date(r.firstSeenAt).getTime(),
};

export interface ListingsTableProps {
  rows: ListingsTableRow[];
  defaultSort?: SortState | null;
  onRowClick?: (r: ListingsTableRow) => void;
  selectedId?: string | null;
  onToggleFavorite?: (id: string, next: boolean) => void;
  onToggleExclude?: (id: string, next: boolean) => void;
  /** Optional content rendered as a full-width row beneath the selected row. */
  renderExpanded?: (r: ListingsTableRow) => React.ReactNode;
}

export const ListingsTable: React.FC<ListingsTableProps> = ({
  rows,
  defaultSort = { key: 'firstSeenAt', dir: 'desc' },
  onRowClick,
  selectedId,
  onToggleFavorite,
  onToggleExclude,
  renderExpanded,
}) => {
  const { sortedRows, sortKey, sortDir, requestSort } = useSortableTable({
    rows,
    accessors,
    initial: defaultSort,
  });

  return (
    <div className="rounded-sm border border-neutral-200 bg-white overflow-x-auto">
      <table className="w-full min-w-[860px] text-[12.5px]" data-testid="listings-table">
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
              label="Locality"
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
              label="Land"
              sortKey="landAre"
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
              <React.Fragment key={r.id}>
                <tr
                  data-listing-id={r.id}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={`hover:bg-neutral-50 ${onRowClick ? 'cursor-pointer' : ''} ${isSelected ? 'bg-accent/5' : ''}`}
                >
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {r.isNew && <Badge variant="default">NEW</Badge>}
                      {drop !== null && drop > 0 && <Badge variant="warning">−{drop}%</Badge>}
                      {r.typeMismatch && r.derivedType && (
                        <Badge variant="warning" title={(r.mismatchReasons ?? []).join('; ')}>
                          {r.derivedType}
                        </Badge>
                      )}
                      {r.regionMismatch && (
                        <Badge variant="warning" title={(r.mismatchReasons ?? []).join('; ')}>
                          Out-of-region: {r.district ?? '?'}
                        </Badge>
                      )}
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
                    {r.landAre != null ? `${r.landAre} ar` : '—'}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-neutral-500">
                    {fmt.rel(r.firstSeenAt)}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        aria-label={r.watchlist ? 'Remove favorite' : 'Add favorite'}
                        title={r.watchlist ? 'Remove favorite' : 'Add favorite'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite?.(r.id, !r.watchlist);
                        }}
                        className={`text-base leading-none ${r.watchlist ? 'text-amber-500' : 'text-neutral-300 hover:text-neutral-500'}`}
                      >
                        {r.watchlist ? '★' : '☆'}
                      </button>
                      <button
                        type="button"
                        aria-label={r.excluded ? 'Unexclude' : 'Exclude'}
                        title={r.excluded ? 'Unexclude' : 'Exclude'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleExclude?.(r.id, !r.excluded);
                        }}
                        className={`text-[11px] leading-none rounded-sm border px-1.5 py-0.5 font-medium transition-colors ${r.excluded ? 'border-error/40 bg-error/10 text-error' : 'border-neutral-300 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600'}`}
                      >
                        ✕
                      </button>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-sm border border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                      >
                        Open ↗
                      </a>
                    </div>
                  </td>
                </tr>
                {isSelected && renderExpanded && (
                  <tr className="bg-neutral-50">
                    <td colSpan={9} className="p-0">
                      {renderExpanded(r)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

import React from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { SortableTh } from '@/components/ui/SortableTh.js';
import { fmt } from '@/lib/format.js';
import { useSortableTable, type Accessors, type SortState } from '@/lib/useSortableTable.js';
import type { BestBuyRow, PriceDropRow } from './types.js';

const ScoreBar: React.FC<{ score: number }> = ({ score }) => {
  const pct = (Math.min(Math.max(score, 0), 3) / 3) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-neutral-100 overflow-hidden">
        <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono tabular-nums text-[11px] text-neutral-700">
        {score.toFixed(1)}
      </span>
    </div>
  );
};

const bestBuyAccessors: Accessors<BestBuyRow> = {
  title: (r) => r.title,
  type: (r) => r.type,
  district: (r) => r.district,
  priceEur: (r) => r.priceEur,
  eurPerSqm: (r) => r.eurPerSqm,
  discount: (r) => r.discount,
  yearBuilt: (r) => r.yearBuilt,
  daysOnMkt: (r) => r.daysOnMkt,
  dropPct: (r) => (r.priceDrop ? r.dropPct : null),
  score: (r) => r.score,
};

export const BestBuysTable: React.FC<{
  rows: BestBuyRow[];
  compact?: boolean;
  fullCols?: boolean;
  startRank?: number;
  onRowClick?: (r: BestBuyRow) => void;
  sort?: SortState | null;
  onSortChange?: (next: SortState) => void;
  defaultSort?: SortState | null;
}> = ({
  rows,
  compact = false,
  fullCols = false,
  startRank = 1,
  onRowClick,
  sort,
  onSortChange,
  defaultSort = { key: 'score', dir: 'desc' },
}) => {
  const { sortedRows, sortKey, sortDir, requestSort } = useSortableTable({
    rows,
    accessors: bestBuyAccessors,
    initial: defaultSort,
    controlled: sort !== undefined ? sort : undefined,
    onSortChange,
  });
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
          <th className="py-2 w-8">Rank</th>
          <SortableTh
            label="Listing"
            sortKey="title"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={requestSort}
          />
          {!compact && (
            <SortableTh
              label="Type"
              sortKey="type"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
            />
          )}
          <SortableTh
            label="District"
            sortKey="district"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={requestSort}
          />
          <SortableTh
            label="Price"
            sortKey="priceEur"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={requestSort}
            align="right"
          />
          <SortableTh
            label="€/m²"
            sortKey="eurPerSqm"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={requestSort}
            align="right"
          />
          <SortableTh
            label="vs median"
            sortKey="discount"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={requestSort}
            align="right"
          />
          {fullCols && (
            <SortableTh
              label="Year"
              sortKey="yearBuilt"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              align="right"
            />
          )}
          {fullCols && (
            <SortableTh
              label="DOM"
              sortKey="daysOnMkt"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              align="right"
            />
          )}
          {fullCols && (
            <SortableTh
              label="Drop"
              sortKey="dropPct"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              align="right"
            />
          )}
          <SortableTh
            label="Score"
            sortKey="score"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={requestSort}
            className="w-32"
          />
          {fullCols && <th className="py-2 w-6" />}
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {sortedRows.map((r, i) => (
          <tr
            key={r.id}
            className={`hover:bg-neutral-50 ${onRowClick ? 'cursor-pointer' : ''}`}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
          >
            <td className="py-1.5 tabular-nums text-neutral-400">#{startRank + i}</td>
            <td className="py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[11px] text-neutral-400">{r.id.slice(-4)}</span>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="truncate text-neutral-800 max-w-[220px] hover:text-teal-700 hover:underline"
                  title={r.title}
                >
                  {r.title}
                </a>
                {r.priceDrop && <Badge variant="warning">drop</Badge>}
              </div>
            </td>
            {!compact && (
              <td className="py-1.5">
                <Badge>{r.type}</Badge>
              </td>
            )}
            <td className="py-1.5 text-neutral-600">{r.district}</td>
            <td className="py-1.5 text-right tabular-nums font-medium">{fmt.eur(r.priceEur)}</td>
            <td className="py-1.5 text-right tabular-nums text-neutral-600">€{r.eurPerSqm}</td>
            <td className="py-1.5 text-right">
              <span
                className={`tabular-nums font-medium ${
                  r.discount >= 15
                    ? 'text-emerald-700'
                    : r.discount >= 8
                      ? 'text-teal-700'
                      : 'text-neutral-600'
                }`}
              >
                {r.discount}% under
              </span>
            </td>
            {fullCols && (
              <td className="py-1.5 text-right tabular-nums text-neutral-500">{r.yearBuilt}</td>
            )}
            {fullCols && (
              <td className="py-1.5 text-right tabular-nums text-neutral-500">
                {r.daysOnMkt < 24 ? `${r.daysOnMkt}h` : `${Math.round(r.daysOnMkt / 24)}d`}
              </td>
            )}
            {fullCols && (
              <td className="py-1.5 text-right">
                {r.priceDrop ? (
                  <span className="tabular-nums text-amber-700">−{Math.round(r.dropPct)}%</span>
                ) : (
                  <span className="text-neutral-300">—</span>
                )}
              </td>
            )}
            <td className="py-1.5">
              <ScoreBar score={r.score} />
            </td>
            {fullCols && <td className="py-1.5 text-neutral-300">›</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const priceDropAccessors: Accessors<PriceDropRow> = {
  title: (r) => r.title,
  type: (r) => r.type,
  district: (r) => r.district,
  priceWas: (r) => r.priceWas,
  priceEur: (r) => r.priceEur,
  dropPct: (r) => r.dropPct,
  dropEur: (r) => r.dropEur,
  when: (r) => parseInt(r.when, 10),
};

export const PriceDropsTable: React.FC<{
  rows: PriceDropRow[];
  compact?: boolean;
  fullCols?: boolean;
  startRank?: number;
  onRowClick?: (r: PriceDropRow) => void;
  sort?: SortState | null;
  onSortChange?: (next: SortState) => void;
  defaultSort?: SortState | null;
}> = ({
  rows,
  compact = false,
  fullCols = false,
  startRank = 1,
  onRowClick,
  sort,
  onSortChange,
  defaultSort = { key: 'dropPct', dir: 'desc' },
}) => {
  const { sortedRows, sortKey, sortDir, requestSort } = useSortableTable({
    rows,
    accessors: priceDropAccessors,
    initial: defaultSort,
    controlled: sort !== undefined ? sort : undefined,
    onSortChange,
  });
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
          <th className="py-2 w-8">Rank</th>
          <SortableTh
            label="Listing"
            sortKey="title"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={requestSort}
          />
          {!compact && (
            <SortableTh
              label="Type"
              sortKey="type"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
            />
          )}
          <SortableTh
            label="District"
            sortKey="district"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={requestSort}
          />
          <SortableTh
            label="Was"
            sortKey="priceWas"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={requestSort}
            align="right"
          />
          <SortableTh
            label="Now"
            sortKey="priceEur"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={requestSort}
            align="right"
          />
          <SortableTh
            label="Drop"
            sortKey="dropPct"
            activeKey={sortKey}
            activeDir={sortDir}
            onSort={requestSort}
            align="right"
          />
          {fullCols && (
            <SortableTh
              label="Δ €"
              sortKey="dropEur"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              align="right"
            />
          )}
          {fullCols && (
            <SortableTh
              label="When"
              sortKey="when"
              activeKey={sortKey}
              activeDir={sortDir}
              onSort={requestSort}
              align="right"
            />
          )}
          {fullCols && <th className="py-2 w-6" />}
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {sortedRows.map((r, i) => (
          <tr
            key={r.id}
            className={`hover:bg-neutral-50 ${onRowClick ? 'cursor-pointer' : ''}`}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
          >
            <td className="py-1.5 tabular-nums text-neutral-400">#{startRank + i}</td>
            <td className="py-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-neutral-400">{r.id.slice(-4)}</span>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="truncate text-neutral-800 max-w-[220px] hover:text-teal-700 hover:underline"
                  title={r.title}
                >
                  {r.title}
                </a>
              </div>
            </td>
            {!compact && (
              <td className="py-1.5">
                <Badge>{r.type}</Badge>
              </td>
            )}
            <td className="py-1.5 text-neutral-600">{r.district}</td>
            <td className="py-1.5 text-right tabular-nums text-neutral-400 line-through">
              {fmt.eur(r.priceWas)}
            </td>
            <td className="py-1.5 text-right tabular-nums font-medium">{fmt.eur(r.priceEur)}</td>
            <td className="py-1.5 text-right">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700 text-[11px] font-semibold tabular-nums">
                ↓ {r.dropPct}%
              </span>
            </td>
            {fullCols && (
              <td className="py-1.5 text-right tabular-nums text-neutral-500">
                −€{(r.dropEur / 1000).toFixed(0)}k
              </td>
            )}
            {fullCols && (
              <td className="py-1.5 text-right tabular-nums text-neutral-500">{r.when}</td>
            )}
            {fullCols && <td className="py-1.5 text-neutral-300">›</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

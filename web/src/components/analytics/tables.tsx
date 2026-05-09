import React from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { fmt } from '@/lib/format.js';
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

export const BestBuysTable: React.FC<{
  rows: BestBuyRow[];
  compact?: boolean;
  fullCols?: boolean;
  startRank?: number;
  onRowClick?: (r: BestBuyRow) => void;
}> = ({ rows, compact = false, fullCols = false, startRank = 1, onRowClick }) => (
  <table className="w-full text-[12.5px]">
    <thead>
      <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
        <th className="py-2 w-8">Rank</th>
        <th className="py-2">Listing</th>
        {!compact && <th className="py-2">Type</th>}
        <th className="py-2">District</th>
        <th className="py-2 text-right">Price</th>
        <th className="py-2 text-right">€/m²</th>
        <th className="py-2 text-right">vs median</th>
        {fullCols && <th className="py-2 text-right">Year</th>}
        {fullCols && <th className="py-2 text-right">DOM</th>}
        {fullCols && <th className="py-2 text-right">Drop</th>}
        <th className="py-2 w-32">Score</th>
        {fullCols && <th className="py-2 w-6" />}
      </tr>
    </thead>
    <tbody className="divide-y divide-neutral-100">
      {rows.map((r, i) => (
        <tr
          key={r.id}
          className={`hover:bg-neutral-50 ${onRowClick ? 'cursor-pointer' : ''}`}
          onClick={onRowClick ? () => onRowClick(r) : undefined}
        >
          <td className="py-1.5 tabular-nums text-neutral-400">#{startRank + i}</td>
          <td className="py-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[11px] text-neutral-400">{r.id.slice(-4)}</span>
              <span className="truncate text-neutral-800 max-w-[220px]">{r.title}</span>
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

export const PriceDropsTable: React.FC<{
  rows: PriceDropRow[];
  compact?: boolean;
  fullCols?: boolean;
  startRank?: number;
  onRowClick?: (r: PriceDropRow) => void;
}> = ({ rows, compact = false, fullCols = false, startRank = 1, onRowClick }) => (
  <table className="w-full text-[12.5px]">
    <thead>
      <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
        <th className="py-2 w-8">Rank</th>
        <th className="py-2">Listing</th>
        {!compact && <th className="py-2">Type</th>}
        <th className="py-2">District</th>
        <th className="py-2 text-right">Was</th>
        <th className="py-2 text-right">Now</th>
        <th className="py-2 text-right">Drop</th>
        {fullCols && <th className="py-2 text-right">Δ €</th>}
        {fullCols && <th className="py-2 text-right">When</th>}
        {fullCols && <th className="py-2 w-6" />}
      </tr>
    </thead>
    <tbody className="divide-y divide-neutral-100">
      {rows.map((r, i) => (
        <tr
          key={r.id}
          className={`hover:bg-neutral-50 ${onRowClick ? 'cursor-pointer' : ''}`}
          onClick={onRowClick ? () => onRowClick(r) : undefined}
        >
          <td className="py-1.5 tabular-nums text-neutral-400">#{startRank + i}</td>
          <td className="py-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-neutral-400">{r.id.slice(-4)}</span>
              <span className="truncate text-neutral-800 max-w-[220px]">{r.title}</span>
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

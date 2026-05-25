import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiCall } from '@/lib/api.js';
import { fmt } from '@/lib/format.js';

interface PricePoint {
  priceEur: number;
  capturedAt: string;
  deltaPct: number | null;
  direction: 'up' | 'down' | 'baseline';
}

interface PriceHistoryResponse {
  points: PricePoint[];
}

interface PriceHistoryPanelProps {
  listingId: string;
}

export const PriceHistoryPanel: React.FC<PriceHistoryPanelProps> = ({ listingId }) => {
  const { data, isLoading, error } = useQuery<PriceHistoryResponse>({
    queryKey: ['price-history', listingId],
    queryFn: () => apiCall<PriceHistoryResponse>(`/listings/${listingId}/price-history`),
  });

  return (
    <div className="bg-neutral-50 px-3 py-3 text-xs" data-testid="price-history-panel">
      <div className="mb-2 font-medium text-neutral-500">Price history</div>
      {isLoading && <p className="text-neutral-400">Loading…</p>}
      {error && <p className="text-error">Failed to load price history</p>}
      {data &&
        (data.points.length <= 1 ? (
          <p className="text-neutral-400">No price changes recorded yet.</p>
        ) : (
          <ul className="space-y-1">
            {[...data.points].reverse().map((p) => (
              <li
                key={`${p.capturedAt}-${p.priceEur}`}
                className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-4 tabular-nums"
              >
                <span className="font-medium text-neutral-900">{fmt.eur(p.priceEur)}</span>
                {p.direction === 'baseline' ? (
                  <span className="text-neutral-400">first seen</span>
                ) : (
                  <span className={p.direction === 'up' ? 'text-error' : 'text-success'}>
                    {p.direction === 'up' ? '▲' : '▼'} {p.deltaPct! > 0 ? '+' : ''}
                    {p.deltaPct!.toFixed(1)}%
                  </span>
                )}
                <span className="text-right text-neutral-400">{fmt.date(p.capturedAt)}</span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
};

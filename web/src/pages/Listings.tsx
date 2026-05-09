import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import { Input } from '@/components/ui/Input.js';
import { PhotoPlaceholder } from '@/components/ui/PhotoPlaceholder.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { apiCall } from '@/lib/api.js';
import { fmt } from '@/lib/format.js';

interface Listing {
  id: string;
  url: string;
  title: string;
  priceEur: number | null;
  priceWas?: number;
  areaSqm: number | null;
  landSqm?: number;
  rooms: number | null;
  floors?: number;
  yearBuilt?: number;
  district: string | null;
  street?: string;
  firstSeenAt: string;
  snapshots?: number;
  flags?: string[];
  isNew?: boolean;
}

const PAGE_SIZE = 50;

// Fallback bounds while facets are loading; server-derived bounds replace
// these once /api/listings/facets responds. Slightly generous so the rail
// renders sensibly on a fresh DB before any sweep has run.
const PRICE_MAX_FALLBACK = 250000;
const PRICE_MIN_FALLBACK = 0;

interface ListingsFacets {
  total: number;
  districts: string[];
  price: { min: number | null; max: number | null };
  rooms: { min: number | null; max: number | null };
  areaSqm: { min: number | null; max: number | null };
}

export const Listings: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [maxPrice, setMaxPrice] = useState(PRICE_MAX_FALLBACK);
  const [district, setDistrict] = useState('all');
  const [sort, setSort] = useState<'newest' | 'price' | 'eurm2'>('newest');
  const [page, setPage] = useState(0);
  const queryClient = useQueryClient();

  // Observed-data facets — districts and price bounds come from the actual
  // catalog rather than hardcoded values. Once loaded, the slider snaps to
  // the data's max if the user hasn't already moved it past it.
  const { data: facets } = useQuery<ListingsFacets>({
    queryKey: ['listings-facets'],
    queryFn: () => apiCall('/listings/facets'),
  });
  const priceMax = facets?.price?.max ?? PRICE_MAX_FALLBACK;
  const priceMin = facets?.price?.min ?? PRICE_MIN_FALLBACK;
  const districts = facets?.districts ?? [];
  // If the server's max is below the slider's current position, clamp down.
  useEffect(() => {
    if (facets && maxPrice > priceMax) setMaxPrice(priceMax);
    // initial-only clamp; intentionally exclude maxPrice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets]);

  // Sweep-row links set ?firstSeenAfter (new only) or ?lastFetchedAfter
  // (touched by sweep) plus ?fromSweep=<id> for the breadcrumb chip.
  const firstSeenAfter = searchParams.get('firstSeenAfter') ?? undefined;
  const lastFetchedAfter = searchParams.get('lastFetchedAfter') ?? undefined;
  const fromSweep = searchParams.get('fromSweep');
  const sweepFilterActive = firstSeenAfter || lastFetchedAfter;

  // Reset to page 0 whenever any filter changes — page N may not exist for the
  // new query (smaller result set).
  useEffect(() => {
    setPage(0);
  }, [q, maxPrice, district, sort, firstSeenAfter, lastFetchedAfter]);

  const { data, isLoading, error } = useQuery<{ listings: Listing[]; total: number }>({
    queryKey: ['listings', { q, maxPrice, district, sort, page, firstSeenAfter, lastFetchedAfter }],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q) p.append('q', q);
      if (maxPrice < priceMax) p.append('maxPrice', String(maxPrice));
      if (district !== 'all') p.append('district', district);
      if (firstSeenAfter) p.append('firstSeenAfter', firstSeenAfter);
      if (lastFetchedAfter) p.append('lastFetchedAfter', lastFetchedAfter);
      p.append('sort', sort);
      p.append('limit', String(PAGE_SIZE));
      p.append('offset', String(page * PAGE_SIZE));
      return apiCall(`/listings?${p}`);
    },
  });

  const clearSweepFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('firstSeenAfter');
    next.delete('lastFetchedAfter');
    next.delete('fromSweep');
    setSearchParams(next);
  };

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const onLastPage = page >= pageCount - 1;

  return (
    <div data-screen-label="Listings">
      <PageHeader
        title="Listings"
        subtitle={`${data?.total ?? '…'} listings · ${maxPrice < priceMax ? `€${maxPrice.toLocaleString()} max` : 'any price'}`}
        actions={
          <Button
            variant="secondary"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['listings'] })}
          >
            Refresh
          </Button>
        }
      />

      {sweepFilterActive && (
        <div className="mb-4 flex items-center gap-2 rounded-sm border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
          <span className="text-neutral-700">
            {firstSeenAfter && (
              <>
                Filtered to listings first seen after{' '}
                <span className="font-mono">{new Date(firstSeenAfter).toLocaleString()}</span>
              </>
            )}
            {lastFetchedAfter && (
              <>
                Filtered to listings fetched after{' '}
                <span className="font-mono">{new Date(lastFetchedAfter).toLocaleString()}</span>
              </>
            )}
            {fromSweep && (
              <>
                {' '}
                · from sweep <span className="font-mono">{fromSweep}</span>
              </>
            )}
          </span>
          <button onClick={clearSweepFilter} className="ml-auto text-blue-600 hover:underline">
            Clear
          </button>
        </div>
      )}

      <div className="grid grid-cols-[240px_1fr] gap-6">
        <Card className="self-start">
          <div className="space-y-5 text-sm">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                Search
              </label>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Title, district…"
              />
            </div>
            <div>
              <div className="flex justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Max price
                </label>
                <span className="text-xs tabular-nums text-neutral-600">{fmt.eur(maxPrice)}</span>
              </div>
              <input
                type="range"
                min={Math.max(0, priceMin)}
                max={priceMax}
                step={Math.max(1000, Math.round((priceMax - priceMin) / 50))}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                District
              </div>
              <div className="space-y-0.5">
                <button
                  onClick={() => setDistrict('all')}
                  className={`w-full text-left rounded-sm px-2 py-1.5 text-sm transition-colors ${district === 'all' ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
                >
                  All districts
                </button>
                {districts.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDistrict(d)}
                    className={`w-full text-left rounded-sm px-2 py-1.5 text-sm transition-colors ${district === d ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
                  >
                    {d}
                  </button>
                ))}
                {!facets && (
                  <p className="px-2 py-1.5 text-xs text-neutral-400">Loading districts…</p>
                )}
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-1 rounded-sm bg-neutral-100 p-0.5">
              {(['newest', 'price', 'eurm2'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={`rounded-sm px-3 py-1 text-xs font-medium transition-colors ${sort === s ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400'}`}
                >
                  {s === 'newest' ? 'Newest' : s === 'price' ? 'Price ↑' : '€/m² ↑'}
                </button>
              ))}
            </div>
            <span className="text-xs text-neutral-400">
              {data?.listings?.length ?? 0} of {total} · page {page + 1} of {pageCount}
            </span>
          </div>

          {isLoading && <p className="text-sm text-neutral-400">Loading…</p>}
          {error && <p className="text-sm text-error">Error loading listings</p>}
          {data?.listings?.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || isLoading}
              >
                ← Prev
              </Button>
              <span className="text-xs tabular-nums text-neutral-500">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={onLastPage || isLoading}
              >
                Next →
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ListingCard: React.FC<{ l: Listing }> = ({ l }) => {
  const drop = l.priceWas && l.priceEur ? Math.round((1 - l.priceEur / l.priceWas) * 100) : null;
  const eurm2 = l.areaSqm && l.priceEur ? Math.round(l.priceEur / l.areaSqm) : 0;
  return (
    <a
      href={l.url}
      target="_blank"
      rel="noopener noreferrer"
      className="grid grid-cols-[120px_1fr_auto] gap-4 rounded-sm bg-white p-3 border border-neutral-200 hover:border-neutral-400 transition-colors"
    >
      <PhotoPlaceholder id={l.id} className="h-[88px]" label={`#${String(l.id).slice(-4)}`} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          {l.isNew && <Badge variant="default">NEW</Badge>}
          {drop && <Badge variant="warning">−{drop}%</Badge>}
        </div>
        <h3 className="truncate text-sm font-semibold text-neutral-900">{l.title}</h3>
        <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-neutral-600 tabular-nums">
          <span>
            <span className="text-neutral-400">district </span>
            {l.district}
          </span>
          <span>
            <span className="text-neutral-400">area </span>
            {l.areaSqm} m²
          </span>
          {l.landSqm && (
            <span>
              <span className="text-neutral-400">land </span>
              {l.landSqm} m²
            </span>
          )}
          {l.rooms && (
            <span>
              <span className="text-neutral-400">rooms </span>
              {l.rooms}
            </span>
          )}
          {l.yearBuilt && (
            <span>
              <span className="text-neutral-400">built </span>
              {l.yearBuilt}
            </span>
          )}
          <span>
            <span className="text-neutral-400">first seen </span>
            {fmt.rel(l.firstSeenAt)}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end justify-between text-right">
        <div>
          <div className="text-lg font-semibold tabular-nums text-neutral-900">
            {fmt.eur(l.priceEur)}
          </div>
          {l.priceWas && (
            <div className="text-xs tabular-nums text-neutral-400 line-through">
              {fmt.eur(l.priceWas)}
            </div>
          )}
          <div className="text-xs tabular-nums text-neutral-400">€{eurm2}/m²</div>
        </div>
        <span className="rounded-sm border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700">
          Open ↗
        </span>
      </div>
    </a>
  );
};

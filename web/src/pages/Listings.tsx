import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import { Input } from '@/components/ui/Input.js';
import { PhotoPlaceholder } from '@/components/ui/PhotoPlaceholder.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { ListingsTable } from '@/components/listings/ListingsTable.js';
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
  lastFetchedAt?: string;
  watchlist?: boolean;
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
  // Empty array == "All districts". Multiple values send `district=A,B` to the
  // backend, which compiles to a SQL `IN (...)` clause (see searchListings).
  const [districtsRaw, setDistrictsRaw] = useState<string[]>([]);
  // De-dupe at the setter so any future entry point (URL hydration, "select
  // all", paste-from-saved-filter) can't produce duplicate chips that the
  // SQL IN clause would silently collapse.
  const setDistricts = (next: string[]) => setDistrictsRaw(Array.from(new Set(next)));
  const districts = districtsRaw;
  const [sort, setSort] = useState<'newest' | 'price' | 'eurm2'>('newest');
  const [view, setView] = useState<'cards' | 'table'>('cards');
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
  const districtOptions = facets?.districts ?? [];
  // If the server's max is below the slider's current position, clamp down.
  useEffect(() => {
    if (facets && maxPrice > priceMax) setMaxPrice(priceMax);
    // initial-only clamp; intentionally exclude maxPrice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets]);

  // Sweep-row links set ?firstSeenAfter (new only) or ?lastFetchedAfter
  // (touched by sweep) plus ?fromSweep=<id> for the breadcrumb chip.
  // ?highlight=<listingId> tells us which specific listing was clicked on
  // the sweep detail page so the matching card can be visually marked +
  // scrolled into view.
  const firstSeenAfter = searchParams.get('firstSeenAfter') ?? undefined;
  const lastFetchedAfter = searchParams.get('lastFetchedAfter') ?? undefined;
  const fromSweep = searchParams.get('fromSweep');
  const highlightId = searchParams.get('highlight');
  const sweepFilterActive = firstSeenAfter || lastFetchedAfter;

  // Selected card — driven by clicks on the listings grid OR seeded from
  // the URL ?highlight= when arriving from a sweep detail link. Local state
  // so the URL stays clean as the user clicks around; the URL highlight
  // wins only on the first relevant render.
  const [selectedId, setSelectedId] = useState<string | null>(highlightId);
  // Keep selection in sync with URL changes (e.g., user clicks a different
  // sweep link that brings them back here with a new highlight).
  useEffect(() => {
    if (highlightId) setSelectedId(highlightId);
  }, [highlightId]);

  // Reset to page 0 whenever any filter changes — page N may not exist for the
  // new query (smaller result set).
  const districtsKey = districts.join(',');
  useEffect(() => {
    setPage(0);
  }, [q, maxPrice, districtsKey, sort, firstSeenAfter, lastFetchedAfter]);

  const { data, isLoading, error } = useQuery<{ listings: Listing[]; total: number }>({
    queryKey: [
      'listings',
      { q, maxPrice, districtsKey, sort, page, firstSeenAfter, lastFetchedAfter },
    ],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q) p.append('q', q);
      if (maxPrice < priceMax) p.append('maxPrice', String(maxPrice));
      if (districts.length > 0) p.append('district', districts.join(','));
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
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  District
                </span>
                {districts.length > 0 && (
                  <button
                    onClick={() => setDistricts([])}
                    className="text-[11px] text-neutral-500 hover:text-neutral-800"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                <button
                  onClick={() => setDistricts([])}
                  aria-pressed={districts.length === 0}
                  className={`w-full text-left rounded-sm px-2 py-1.5 text-sm transition-colors ${districts.length === 0 ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
                >
                  All districts
                </button>
                {districtOptions.map((d) => {
                  const active = districts.includes(d);
                  return (
                    <button
                      key={d}
                      onClick={() =>
                        setDistricts(active ? districts.filter((x) => x !== d) : [...districts, d])
                      }
                      aria-pressed={active}
                      className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${active ? 'border-white bg-white text-neutral-900' : 'border-neutral-300 bg-white'}`}
                        aria-hidden
                      >
                        {active && <span className="text-[10px] leading-none">✓</span>}
                      </span>
                      <span>{d}</span>
                    </button>
                  );
                })}
                {!facets && (
                  <p className="px-2 py-1.5 text-xs text-neutral-400">Loading districts…</p>
                )}
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div
                className="flex gap-1 rounded-sm bg-neutral-100 p-0.5"
                role="tablist"
                aria-label="Sort"
              >
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
              <div
                className="flex gap-1 rounded-sm bg-neutral-100 p-0.5"
                role="tablist"
                aria-label="View"
              >
                {(['cards', 'table'] as const).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    className={`rounded-sm px-3 py-1 text-xs font-medium transition-colors ${view === v ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400'}`}
                  >
                    {v === 'cards' ? 'Cards' : 'Table'}
                  </button>
                ))}
              </div>
            </div>
            <span className="text-xs text-neutral-400">
              {data?.listings?.length ?? 0} of {total} · page {page + 1} of {pageCount}
            </span>
          </div>

          {isLoading && <p className="text-sm text-neutral-400">Loading…</p>}
          {error && <p className="text-sm text-error">Error loading listings</p>}
          {view === 'cards' &&
            data?.listings?.map((l) => (
              <ListingCard
                key={l.id}
                l={l}
                selected={selectedId === l.id}
                autoScroll={highlightId === l.id}
                onSelect={() => setSelectedId((cur) => (cur === l.id ? null : l.id))}
              />
            ))}
          {view === 'table' && data?.listings && (
            <ListingsTable
              rows={data.listings}
              selectedId={selectedId}
              onRowClick={(r) => setSelectedId((cur) => (cur === r.id ? null : r.id))}
            />
          )}

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

interface ListingCardProps {
  l: Listing;
  selected: boolean;
  /** True when this card was deep-linked from a sweep (?highlight=<id>) on
   *  initial render — triggers scrollIntoView so the user lands on it. */
  autoScroll: boolean;
  onSelect: () => void;
}

const ListingCard: React.FC<ListingCardProps> = ({ l, selected, autoScroll, onSelect }) => {
  const drop = l.priceWas && l.priceEur ? Math.round((1 - l.priceEur / l.priceWas) * 100) : null;
  const eurm2 = l.areaSqm && l.priceEur ? Math.round(l.priceEur / l.areaSqm) : 0;
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // intentionally fire only when autoScroll first becomes true (URL deep-link)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScroll]);
  const queryClient = useQueryClient();
  const toggleWatch = useMutation({
    mutationFn: () =>
      apiCall(`/listings/${l.id}/watchlist`, {
        method: 'PUT',
        body: JSON.stringify({ watchlist: !l.watchlist }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['listings'] }),
  });
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      data-listing-id={l.id}
      className={`grid grid-cols-[120px_1fr_auto] gap-4 rounded-sm bg-white p-3 border transition-colors cursor-pointer ${
        selected
          ? 'border-accent ring-2 ring-accent ring-offset-1'
          : 'border-neutral-200 hover:border-neutral-400'
      }`}
    >
      <PhotoPlaceholder id={l.id} className="h-[88px]" label={`#${String(l.id).slice(-4)}`} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          {l.isNew && <Badge variant="default">NEW</Badge>}
          {drop && <Badge variant="warning">−{drop}%</Badge>}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleWatch.mutate();
            }}
            disabled={toggleWatch.isPending}
            title={l.watchlist ? 'Remove from watchlist' : 'Add to watchlist'}
            className={`text-base leading-none -mt-0.5 ${l.watchlist ? 'text-amber-500' : 'text-neutral-300 hover:text-neutral-500'}`}
          >
            {l.watchlist ? '★' : '☆'}
          </button>
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
          {l.lastFetchedAt && (
            <span>
              <span className="text-neutral-400">refreshed </span>
              {fmt.rel(l.lastFetchedAt)}
            </span>
          )}
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
        <a
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="rounded-sm border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Open ↗
        </a>
      </div>
    </div>
  );
};

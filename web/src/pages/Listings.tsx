import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import { PhotoPlaceholder } from '@/components/ui/PhotoPlaceholder.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { ListingsTable } from '@/components/listings/ListingsTable.js';
import { PriceHistoryPanel } from '@/components/listings/PriceHistoryPanel.js';
import { FilterRail, type FilterFacets } from '@/components/filters/FilterRail.js';
import { useBrowseFilters } from '@/lib/useBrowseFilters.js';
import { bucketToRoomsValues, type RoomsBucket } from '@/lib/listing-type.js';
import { apiCall } from '@/lib/api.js';
import { fmt } from '@/lib/format.js';

interface Listing {
  id: string;
  url: string;
  title: string;
  priceEur: number | null;
  priceWas?: number;
  areaSqm: number | null;
  landAre?: number;
  rooms: number | null;
  floors?: number;
  yearBuilt?: number;
  district: string | null;
  street?: string;
  firstSeenAt: string;
  lastFetchedAt?: string;
  watchlist?: boolean;
  excluded?: boolean;
  snapshots?: number;
  flags?: string[];
  isNew?: boolean;
  derivedType?: 'House' | 'Villa' | 'Townhouse' | 'Duplex';
  typeMismatch?: boolean;
  regionMismatch?: boolean;
  mismatchReasons?: string[];
}

const PAGE_SIZE = 50;

interface ListingsFacetsResponse extends FilterFacets {
  total: number;
  rooms: { min: number | null; max: number | null };
  areaSqm: { min: number | null; max: number | null };
}

export const Listings: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sort, setSort] = useState<'newest' | 'price' | 'eurm2'>('newest');
  const [view, setView] = useState<'cards' | 'table'>('table');
  const [page, setPage] = useState(0);
  const queryClient = useQueryClient();

  // Observed-data facets — districts, price bounds, type/rooms options, and the
  // boolean-toggle counts all come from the catalog (GET /api/listings/facets)
  // rather than hardcoded values.
  const { data: facets } = useQuery<ListingsFacetsResponse>({
    queryKey: ['listings-facets'],
    queryFn: () => apiCall('/listings/facets'),
  });

  const filters = useBrowseFilters();
  const { state } = filters;
  const {
    q,
    minPrice,
    maxPrice,
    minArea,
    maxArea,
    minLand,
    maxLand,
    minFloors,
    maxFloors,
    districts,
    sectors,
    type,
    rooms,
    favoritesOnly,
    showExcluded,
    hideMislabeled,
  } = state;

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
  const sectorsKey = sectors.join(',');
  useEffect(() => {
    setPage(0);
  }, [
    q,
    minPrice,
    maxPrice,
    minArea,
    maxArea,
    minLand,
    maxLand,
    minFloors,
    maxFloors,
    districtsKey,
    sectorsKey,
    type,
    rooms,
    sort,
    firstSeenAfter,
    lastFetchedAfter,
    favoritesOnly,
    showExcluded,
  ]);

  const { data, isLoading, error } = useQuery<{ listings: Listing[]; total: number }>({
    queryKey: [
      'listings',
      {
        q,
        minPrice,
        maxPrice,
        minArea,
        maxArea,
        minLand,
        maxLand,
        minFloors,
        maxFloors,
        districtsKey,
        sectorsKey,
        type,
        rooms,
        sort,
        page,
        firstSeenAfter,
        lastFetchedAfter,
        favoritesOnly,
        showExcluded,
      },
    ],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q) p.append('q', q);
      if (minPrice != null) p.append('minPrice', String(minPrice));
      if (maxPrice != null) p.append('maxPrice', String(maxPrice));
      if (minArea != null) p.append('minAreaSqm', String(minArea));
      if (maxArea != null) p.append('maxAreaSqm', String(maxArea));
      if (minLand != null) p.append('minLandAre', String(minLand));
      if (maxLand != null) p.append('maxLandAre', String(maxLand));
      if (minFloors != null) p.append('minFloors', String(minFloors));
      if (maxFloors != null) p.append('maxFloors', String(maxFloors));
      if (districts.length > 0) p.append('district', districts.join(','));
      if (sectors.length > 0) p.append('sector', sectors.join(','));
      if (type !== 'all') p.append('type', type);
      // Rooms bucket → min/max integers the listings endpoint already supports.
      // The open-ended '5+' bucket sends only a lower bound.
      if (rooms !== 'all') {
        const values = bucketToRoomsValues(rooms as RoomsBucket);
        const min = values[0];
        const max = values[values.length - 1];
        if (min != null) p.append('minRooms', String(min));
        if (rooms !== '5+' && max != null) p.append('maxRooms', String(max));
      }
      if (firstSeenAfter) p.append('firstSeenAfter', firstSeenAfter);
      if (lastFetchedAfter) p.append('lastFetchedAfter', lastFetchedAfter);
      if (favoritesOnly) p.append('favorite', 'true');
      if (showExcluded) p.append('includeExcluded', 'true');
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

  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      apiCall(`/listings/${id}/watchlist`, {
        method: 'PUT',
        body: JSON.stringify({ watchlist: next }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['listings'] }),
  });

  const toggleExcludeMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      apiCall(`/listings/${id}/excluded`, {
        method: 'PUT',
        body: JSON.stringify({ excluded: next }),
      }),
    // Excluding changes the facet universe (district/sector options + price
    // bounds), so refresh the rail too — not just the listing rows.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['listings'] });
      void queryClient.invalidateQueries({ queryKey: ['listings-facets'] });
    },
  });

  const total = data?.total ?? 0;
  const visibleListings = (data?.listings ?? []).filter(
    (l) => !hideMislabeled || !(l.typeMismatch || l.regionMismatch),
  );
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Client-side hide can empty a server page; don't offer "Next" into nothing.
  const onLastPage = page >= pageCount - 1 || (hideMislabeled && visibleListings.length === 0);

  return (
    <div data-screen-label="Listings">
      <PageHeader
        title="Listings"
        subtitle={`${data?.total ?? '…'} listings`}
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
          <FilterRail
            q={q}
            setQ={filters.setQ}
            minPrice={minPrice}
            maxPrice={maxPrice}
            setMinPrice={filters.setMinPrice}
            setMaxPrice={filters.setMaxPrice}
            minArea={minArea}
            maxArea={maxArea}
            setMinArea={filters.setMinArea}
            setMaxArea={filters.setMaxArea}
            minLand={minLand}
            maxLand={maxLand}
            setMinLand={filters.setMinLand}
            setMaxLand={filters.setMaxLand}
            minFloors={minFloors}
            maxFloors={maxFloors}
            setMinFloors={filters.setMinFloors}
            setMaxFloors={filters.setMaxFloors}
            districts={districts}
            setDistricts={filters.setDistricts}
            sectors={sectors}
            setSectors={filters.setSectors}
            type={type}
            setType={filters.setType}
            rooms={rooms}
            setRooms={filters.setRooms}
            favoritesOnly={favoritesOnly}
            setFavoritesOnly={filters.setFavoritesOnly}
            showExcluded={showExcluded}
            setShowExcluded={filters.setShowExcluded}
            hideMislabeled={hideMislabeled}
            setHideMislabeled={filters.setHideMislabeled}
            facets={facets}
            searchPlaceholder="Title, district…"
          />
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
            visibleListings.map((l) => (
              <React.Fragment key={l.id}>
                <ListingCard
                  l={l}
                  selected={selectedId === l.id}
                  autoScroll={highlightId === l.id}
                  onSelect={() => setSelectedId((cur) => (cur === l.id ? null : l.id))}
                />
                {selectedId === l.id && <PriceHistoryPanel listingId={l.id} />}
              </React.Fragment>
            ))}
          {view === 'table' && (
            <ListingsTable
              rows={visibleListings}
              selectedId={selectedId}
              onRowClick={(r) => setSelectedId((cur) => (cur === r.id ? null : r.id))}
              onToggleFavorite={(id, next) => toggleFavoriteMutation.mutate({ id, next })}
              onToggleExclude={(id, next) => toggleExcludeMutation.mutate({ id, next })}
              renderExpanded={(r) => <PriceHistoryPanel listingId={r.id} />}
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
          {l.typeMismatch && l.derivedType && (
            <Badge variant="warning" title={(l.mismatchReasons ?? []).join('; ')}>
              {l.derivedType}
            </Badge>
          )}
          {l.regionMismatch && (
            <Badge variant="warning" title={(l.mismatchReasons ?? []).join('; ')}>
              Out-of-region: {l.district ?? '?'}
            </Badge>
          )}
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
          {l.landAre && (
            <span>
              <span className="text-neutral-400">land </span>
              {l.landAre} ar
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

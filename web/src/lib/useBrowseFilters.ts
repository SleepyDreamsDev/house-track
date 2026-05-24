import { useEffect, useState } from 'react';

// Fallback price bounds used until /api/listings/facets responds. Slightly
// generous so the rail renders sensibly on a fresh DB before any sweep.
export const PRICE_MAX_FALLBACK = 250000;
export const PRICE_MIN_FALLBACK = 0;

// The facet payload from GET /api/listings/facets. Drives both the rail's
// option lists and its "hide if no data" visibility. Both Listings and
// Analytics consume the same endpoint (shared ['listings-facets'] query key).
export interface FilterFacets {
  districts: string[];
  sectors?: { name: string; count: number }[];
  types: string[];
  roomsValues: number[];
  price: { min: number | null; max: number | null };
  favoritesCount?: number;
  excludedCount?: number;
  mislabeledCount?: number;
}

export interface BrowseFilterState {
  q: string;
  maxPrice: number;
  districts: string[];
  sectors: string[];
  type: string; // 'all' | derived type
  rooms: string; // 'all' | rooms bucket
  favoritesOnly: boolean;
  showExcluded: boolean;
  hideMislabeled: boolean;
}

export interface UseBrowseFilters {
  state: BrowseFilterState;
  setQ: (v: string) => void;
  setMaxPrice: (v: number) => void;
  setDistricts: (v: string[]) => void;
  setSectors: (v: string[]) => void;
  setType: (v: string) => void;
  setRooms: (v: string) => void;
  setFavoritesOnly: (v: boolean) => void;
  setShowExcluded: (v: boolean) => void;
  setHideMislabeled: (v: boolean) => void;
  priceMin: number;
  priceMax: number;
}

// Owns the browse-filter state shared by the Listings and Analytics pages, plus
// the maxPrice/facet clamp logic that previously lived (subtly differently) in
// both. Each page instantiates its own — state is per-page and resets on nav.
export function useBrowseFilters(facets: FilterFacets | undefined): UseBrowseFilters {
  const [q, setQ] = useState('');
  const [maxPrice, setMaxPriceRaw] = useState(PRICE_MAX_FALLBACK);
  const [maxPriceTouched, setMaxPriceTouched] = useState(false);
  const [districts, setDistrictsRaw] = useState<string[]>([]);
  const [sectors, setSectorsRaw] = useState<string[]>([]);
  const [type, setType] = useState('all');
  const [rooms, setRooms] = useState('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [hideMislabeled, setHideMislabeled] = useState(false);

  const priceMax = facets?.price?.max ?? PRICE_MAX_FALLBACK;
  const priceMin = facets?.price?.min ?? PRICE_MIN_FALLBACK;

  // While the slider is untouched, track the catalog max: a fresh page sends no
  // maxPrice param (slider sits at max), and a shrinking catalog clamps the
  // slider down. Once the user moves it, maxPriceTouched locks their choice so
  // facet refreshes can't yank it.
  useEffect(() => {
    if (!facets || maxPriceTouched) return;
    if (maxPrice !== priceMax) setMaxPriceRaw(priceMax);
  }, [facets, priceMax, maxPriceTouched, maxPrice]);

  const setMaxPrice = (v: number) => {
    setMaxPriceTouched(true);
    setMaxPriceRaw(v);
  };
  // De-dupe at the setter so any entry point (URL hydration, "select all",
  // paste-from-saved-filter) can't produce duplicate chips that a SQL IN clause
  // would silently collapse.
  const setDistricts = (next: string[]) => setDistrictsRaw(Array.from(new Set(next)));
  const setSectors = (next: string[]) => setSectorsRaw(Array.from(new Set(next)));

  const state: BrowseFilterState = {
    q,
    maxPrice,
    districts,
    sectors,
    type,
    rooms,
    favoritesOnly,
    showExcluded,
    hideMislabeled,
  };

  return {
    state,
    setQ,
    setMaxPrice,
    setDistricts,
    setSectors,
    setType,
    setRooms,
    setFavoritesOnly,
    setShowExcluded,
    setHideMislabeled,
    priceMin,
    priceMax,
  };
}

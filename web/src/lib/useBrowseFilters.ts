import { useEffect, useState } from 'react';

// Browse filters persist for the browser session under one key, so the values
// survive switching between the Listings and Analytics pages (and a reload
// within the same tab). Cleared when the tab closes.
const STORAGE_KEY = 'house-track:browse-filters';

function readSnapshot(): Partial<BrowseFilterState> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<BrowseFilterState>) : {};
  } catch {
    return {};
  }
}

export interface Bounds {
  min: number | null;
  max: number | null;
}

// The facet payload from GET /api/listings/facets. Drives both the rail's
// option lists and its "hide if no data" visibility. Both Listings and
// Analytics consume the same endpoint (shared ['listings-facets'] query key).
export interface FilterFacets {
  districts: string[];
  // Observed districts inside the Chișinău municipality. Backs the District
  // rail's "Chișinău (municipality)" group, which selects all of them at once.
  municipality?: string[];
  sectors?: { name: string; count: number }[];
  types: string[];
  roomsValues: number[];
  price: Bounds;
  areaSqm?: Bounds;
  landAre?: Bounds;
  floors?: Bounds;
  favoritesCount?: number;
  excludedCount?: number;
  mislabeledCount?: number;
}

export interface BrowseFilterState {
  q: string;
  // Range filters: null means "unbounded" (the input is empty) — so a fresh
  // page sends no price/area params at all.
  minPrice: number | null;
  maxPrice: number | null;
  minArea: number | null;
  maxArea: number | null;
  minLand: number | null;
  maxLand: number | null;
  minFloors: number | null;
  maxFloors: number | null;
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
  setMinPrice: (v: number | null) => void;
  setMaxPrice: (v: number | null) => void;
  setMinArea: (v: number | null) => void;
  setMaxArea: (v: number | null) => void;
  setMinLand: (v: number | null) => void;
  setMaxLand: (v: number | null) => void;
  setMinFloors: (v: number | null) => void;
  setMaxFloors: (v: number | null) => void;
  setDistricts: (v: string[]) => void;
  setSectors: (v: string[]) => void;
  setType: (v: string) => void;
  setRooms: (v: string) => void;
  setFavoritesOnly: (v: boolean) => void;
  setShowExcluded: (v: boolean) => void;
  setHideMislabeled: (v: boolean) => void;
  clearAll: () => void;
}

// Owns the browse-filter state shared by the Listings and Analytics pages.
// Seeded from (and persisted to) sessionStorage so values survive switching
// between pages within a session. Range filters default to null (unbounded);
// the rail seeds bounds as placeholders.
export function useBrowseFilters(): UseBrowseFilters {
  // Read once on mount (lazy) so re-renders don't re-parse storage.
  const [initial] = useState(readSnapshot);
  const [q, setQ] = useState(initial.q ?? '');
  const [minPrice, setMinPrice] = useState<number | null>(initial.minPrice ?? null);
  const [maxPrice, setMaxPrice] = useState<number | null>(initial.maxPrice ?? null);
  const [minArea, setMinArea] = useState<number | null>(initial.minArea ?? null);
  const [maxArea, setMaxArea] = useState<number | null>(initial.maxArea ?? null);
  const [minLand, setMinLand] = useState<number | null>(initial.minLand ?? null);
  const [maxLand, setMaxLand] = useState<number | null>(initial.maxLand ?? null);
  const [minFloors, setMinFloors] = useState<number | null>(initial.minFloors ?? null);
  const [maxFloors, setMaxFloors] = useState<number | null>(initial.maxFloors ?? null);
  const [districts, setDistrictsRaw] = useState<string[]>(initial.districts ?? []);
  const [sectors, setSectorsRaw] = useState<string[]>(initial.sectors ?? []);
  const [type, setType] = useState(initial.type ?? 'all');
  const [rooms, setRooms] = useState(initial.rooms ?? 'all');
  const [favoritesOnly, setFavoritesOnly] = useState(initial.favoritesOnly ?? false);
  const [showExcluded, setShowExcluded] = useState(initial.showExcluded ?? false);
  const [hideMislabeled, setHideMislabeled] = useState(initial.hideMislabeled ?? false);

  // De-dupe at the setter so any entry point (URL hydration, "select all",
  // paste-from-saved-filter) can't produce duplicate chips that a SQL IN clause
  // would silently collapse.
  const setDistricts = (next: string[]) => setDistrictsRaw(Array.from(new Set(next)));
  const setSectors = (next: string[]) => setSectorsRaw(Array.from(new Set(next)));

  // Reset every filter to its default. The persistence effect then writes the
  // cleared snapshot back to sessionStorage.
  const clearAll = () => {
    setQ('');
    setMinPrice(null);
    setMaxPrice(null);
    setMinArea(null);
    setMaxArea(null);
    setMinLand(null);
    setMaxLand(null);
    setMinFloors(null);
    setMaxFloors(null);
    setDistrictsRaw([]);
    setSectorsRaw([]);
    setType('all');
    setRooms('all');
    setFavoritesOnly(false);
    setShowExcluded(false);
    setHideMislabeled(false);
  };

  const state: BrowseFilterState = {
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
  };

  // Persist the whole snapshot whenever any field changes. districts/sectors
  // get a fresh array reference from their setters, so reference-equality deps
  // fire correctly.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore quota / unavailable storage
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    districts,
    sectors,
    type,
    rooms,
    favoritesOnly,
    showExcluded,
    hideMislabeled,
  ]);

  return {
    state,
    setQ,
    setMinPrice,
    setMaxPrice,
    setMinArea,
    setMaxArea,
    setMinLand,
    setMaxLand,
    setMinFloors,
    setMaxFloors,
    setDistricts,
    setSectors,
    setType,
    setRooms,
    setFavoritesOnly,
    setShowExcluded,
    setHideMislabeled,
    clearAll,
  };
}

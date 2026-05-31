import { useState } from 'react';

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
}

// Owns the browse-filter state shared by the Listings and Analytics pages. Each
// page instantiates its own — state is per-page and resets on nav. Range
// filters default to null (unbounded); the rail seeds bounds as placeholders.
export function useBrowseFilters(): UseBrowseFilters {
  const [q, setQ] = useState('');
  const [minPrice, setMinPrice] = useState<number | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [minArea, setMinArea] = useState<number | null>(null);
  const [maxArea, setMaxArea] = useState<number | null>(null);
  const [minLand, setMinLand] = useState<number | null>(null);
  const [maxLand, setMaxLand] = useState<number | null>(null);
  const [minFloors, setMinFloors] = useState<number | null>(null);
  const [maxFloors, setMaxFloors] = useState<number | null>(null);
  const [districts, setDistrictsRaw] = useState<string[]>([]);
  const [sectors, setSectorsRaw] = useState<string[]>([]);
  const [type, setType] = useState('all');
  const [rooms, setRooms] = useState('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [hideMislabeled, setHideMislabeled] = useState(false);

  // De-dupe at the setter so any entry point (URL hydration, "select all",
  // paste-from-saved-filter) can't produce duplicate chips that a SQL IN clause
  // would silently collapse.
  const setDistricts = (next: string[]) => setDistrictsRaw(Array.from(new Set(next)));
  const setSectors = (next: string[]) => setSectorsRaw(Array.from(new Set(next)));

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
  };
}

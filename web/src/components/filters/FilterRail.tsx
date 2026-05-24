import React from 'react';
import { Input } from '@/components/ui/Input.js';
import { fmt } from '@/lib/format.js';
import { roomsBucket, type RoomsBucket } from '@/lib/listing-type.js';
import {
  PRICE_MAX_FALLBACK,
  PRICE_MIN_FALLBACK,
  type FilterFacets,
} from '@/lib/useBrowseFilters.js';

export type { FilterFacets };

const FilterGroupVertical: React.FC<{
  label: string;
  value: string;
  setValue: (v: string) => void;
  options: string[];
}> = ({ label, value, setValue, options }) => (
  <div>
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
      {label}
    </div>
    <div className="flex flex-wrap gap-1">
      {['all', ...options].map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            onClick={() => setValue(o)}
            className={`rounded-md px-2 py-1 text-[12px] ring-1 ring-inset ${
              active
                ? 'bg-neutral-900 text-white ring-neutral-900'
                : 'bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50'
            }`}
          >
            {o === 'all' ? 'All' : o}
          </button>
        );
      })}
    </div>
  </div>
);

// Empty `values` means "all" — same sentinel as the rest of the rail.
const MultiSelectGroupVertical: React.FC<{
  label: string;
  values: string[];
  setValues: (v: string[]) => void;
  options: string[];
}> = ({ label, values, setValues, options }) => {
  const allActive = values.length === 0;
  const toggle = (o: string) => {
    if (values.includes(o)) setValues(values.filter((v) => v !== o));
    else setValues([...values, o]);
  };
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setValues([])}
          aria-pressed={allActive}
          className={`rounded-md px-2 py-1 text-[12px] ring-1 ring-inset ${
            allActive
              ? 'bg-neutral-900 text-white ring-neutral-900'
              : 'bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50'
          }`}
        >
          All
        </button>
        {options.map((o) => {
          const active = values.includes(o);
          return (
            <button
              key={o}
              onClick={() => toggle(o)}
              aria-pressed={active}
              className={`rounded-md px-2 py-1 text-[12px] ring-1 ring-inset ${
                active
                  ? 'bg-neutral-900 text-white ring-neutral-900'
                  : 'bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50'
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ToggleCheckbox: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-neutral-700">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      className="accent-accent"
    />
    {label}
  </label>
);

// Derive the rooms-bucket option list from observed roomsValues so the rail
// only offers buckets that have any listings backing them.
function bucketsFromFacets(roomsValues: number[]): RoomsBucket[] {
  const set = new Set<RoomsBucket>();
  for (const r of roomsValues) set.add(roomsBucket(r));
  return (['1–2', '3', '4', '5+'] as RoomsBucket[]).filter((b) => set.has(b));
}

export interface FilterRailProps {
  q: string;
  setQ: (v: string) => void;
  maxPrice: number;
  setMaxPrice: (v: number) => void;
  districts: string[];
  setDistricts: (v: string[]) => void;
  sectors: string[];
  setSectors: (v: string[]) => void;
  type: string;
  setType: (v: string) => void;
  rooms: string;
  setRooms: (v: string) => void;
  favoritesOnly: boolean;
  setFavoritesOnly: (v: boolean) => void;
  showExcluded: boolean;
  setShowExcluded: (v: boolean) => void;
  // Listings-only: when these are omitted the Hide-mislabeled toggle is never
  // rendered (it filters rendered rows, which only the Listings view has).
  hideMislabeled?: boolean;
  setHideMislabeled?: (v: boolean) => void;
  facets: FilterFacets | undefined;
  extraSlot?: React.ReactNode;
  searchPlaceholder?: string;
}

// The unified browse-filter rail shared by Listings and Analytics. Every group
// is gated on its facet having data ("hide filters with no data in current
// view"); Search is the only always-on control.
export const FilterRail: React.FC<FilterRailProps> = ({
  q,
  setQ,
  maxPrice,
  setMaxPrice,
  districts,
  setDistricts,
  sectors,
  setSectors,
  type,
  setType,
  rooms,
  setRooms,
  favoritesOnly,
  setFavoritesOnly,
  showExcluded,
  setShowExcluded,
  hideMislabeled,
  setHideMislabeled,
  facets,
  extraSlot,
  searchPlaceholder = 'Title…',
}) => {
  const priceMax = facets?.price?.max ?? PRICE_MAX_FALLBACK;
  const priceMin = facets?.price?.min ?? PRICE_MIN_FALLBACK;
  const districtOptions = facets?.districts ?? [];
  const sectorOptions = (facets?.sectors ?? []).map((s) => s.name);
  const types = facets?.types ?? [];
  const buckets = bucketsFromFacets(facets?.roomsValues ?? []);
  const showMislabeled = setHideMislabeled !== undefined && (facets?.mislabeledCount ?? 0) > 0;
  const showFavorites = (facets?.favoritesCount ?? 0) > 0;
  const showExcludedToggle = (facets?.excludedCount ?? 0) > 0;

  return (
    <div className="space-y-4 text-[13px]" data-testid="filter-rail">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500">
        Filters
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Search
        </label>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search listings"
        />
      </div>
      {priceMax > priceMin && (
        <div>
          <div className="mb-1.5 flex justify-between">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Max price
            </label>
            <span className="text-[11px] tabular-nums text-neutral-600">{fmt.eur(maxPrice)}</span>
          </div>
          <input
            type="range"
            min={Math.max(0, priceMin)}
            max={priceMax}
            step={Math.max(1000, Math.round((priceMax - priceMin) / 50))}
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
            className="w-full accent-accent"
            aria-label="Max price"
          />
        </div>
      )}
      {districtOptions.length > 0 && (
        <MultiSelectGroupVertical
          label="District"
          values={districts}
          setValues={setDistricts}
          options={districtOptions}
        />
      )}
      {sectorOptions.length > 0 && (
        <div data-testid="sector-filter">
          <MultiSelectGroupVertical
            label="Sector"
            values={sectors}
            setValues={setSectors}
            options={sectorOptions}
          />
        </div>
      )}
      {types.length > 1 && (
        <FilterGroupVertical
          label="Property type"
          value={type}
          setValue={setType}
          options={types}
        />
      )}
      {buckets.length > 0 && (
        <FilterGroupVertical label="Rooms" value={rooms} setValue={setRooms} options={buckets} />
      )}
      {(showFavorites || showExcludedToggle || showMislabeled) && (
        <div className="space-y-1.5">
          {showFavorites && (
            <ToggleCheckbox
              label="Favorites only"
              checked={favoritesOnly}
              onChange={setFavoritesOnly}
            />
          )}
          {showExcludedToggle && (
            <ToggleCheckbox
              label="Show excluded"
              checked={showExcluded}
              onChange={setShowExcluded}
            />
          )}
          {showMislabeled && setHideMislabeled && (
            <ToggleCheckbox
              label="Hide mislabeled"
              checked={hideMislabeled ?? false}
              onChange={setHideMislabeled}
            />
          )}
        </div>
      )}
      {extraSlot}
    </div>
  );
};

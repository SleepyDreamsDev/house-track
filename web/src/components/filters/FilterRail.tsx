import React from 'react';
import { Input } from '@/components/ui/Input.js';
import { roomsBucket, type RoomsBucket } from '@/lib/listing-type.js';
import { type Bounds, type FilterFacets } from '@/lib/useBrowseFilters.js';

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
// `groups` are convenience selectors (e.g. "Chișinău (municipality)") that set
// the selection to a fixed set of member options in one click.
const MultiSelectGroupVertical: React.FC<{
  label: string;
  values: string[];
  setValues: (v: string[]) => void;
  options: string[];
  groups?: { label: string; members: string[] }[];
}> = ({ label, values, setValues, options, groups }) => {
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
        {(groups ?? []).map((g) => {
          const active = g.members.length > 0 && g.members.every((m) => values.includes(m));
          return (
            <button
              key={g.label}
              onClick={() => setValues(g.members)}
              aria-pressed={active}
              className={`rounded-md px-2 py-1 text-[12px] ring-1 ring-inset ${
                active
                  ? 'bg-neutral-900 text-white ring-neutral-900'
                  : 'bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50'
              }`}
            >
              {g.label}
            </button>
          );
        })}
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

// Min/max numeric range. Empty input = unbounded (null). Placeholders show the
// catalog bounds so the operator knows the available span without pre-filling
// (which would otherwise send a redundant param).
const RangeField: React.FC<{
  label: string;
  unit?: string;
  bounds: Bounds;
  min: number | null;
  max: number | null;
  setMin: (v: number | null) => void;
  setMax: (v: number | null) => void;
}> = ({ label, unit, bounds, min, max, setMin, setMax }) => {
  // Negative bounds are never valid for price/area/floors/land — treat them as
  // empty (unbounded) rather than sending a nonsensical -1 to the API.
  const parse = (s: string) => {
    if (s.trim() === '') return null;
    const n = Number(s);
    return Number.isNaN(n) || n < 0 ? null : n;
  };
  const inputCls =
    'w-full rounded-md px-2 py-1 text-[12px] tabular-nums ring-1 ring-inset ring-neutral-200 focus:ring-neutral-400 focus:outline-none';
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
        {unit ? ` (${unit})` : ''}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={min ?? ''}
          placeholder={bounds.min != null ? String(bounds.min) : 'min'}
          aria-label={`${label} min`}
          onChange={(e) => setMin(parse(e.target.value))}
          className={inputCls}
        />
        <span className="text-[11px] text-neutral-400">–</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={max ?? ''}
          placeholder={bounds.max != null ? String(bounds.max) : 'max'}
          aria-label={`${label} max`}
          onChange={(e) => setMax(parse(e.target.value))}
          className={inputCls}
        />
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

// A range filter is worth showing only when the catalog spans more than one
// value (min < max); a single-valued or empty facet has nothing to narrow.
function hasRange(b: Bounds | undefined): b is Bounds {
  return b != null && b.min != null && b.max != null && b.max > b.min;
}

export interface FilterRailProps {
  q: string;
  setQ: (v: string) => void;
  minPrice: number | null;
  maxPrice: number | null;
  setMinPrice: (v: number | null) => void;
  setMaxPrice: (v: number | null) => void;
  minArea: number | null;
  maxArea: number | null;
  setMinArea: (v: number | null) => void;
  setMaxArea: (v: number | null) => void;
  minLand: number | null;
  maxLand: number | null;
  setMinLand: (v: number | null) => void;
  setMaxLand: (v: number | null) => void;
  minFloors: number | null;
  maxFloors: number | null;
  setMinFloors: (v: number | null) => void;
  setMaxFloors: (v: number | null) => void;
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
  minPrice,
  maxPrice,
  setMinPrice,
  setMaxPrice,
  minArea,
  maxArea,
  setMinArea,
  setMaxArea,
  minLand,
  maxLand,
  setMinLand,
  setMaxLand,
  minFloors,
  maxFloors,
  setMinFloors,
  setMaxFloors,
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
  const districtOptions = facets?.districts ?? [];
  const municipalityMembers = facets?.municipality ?? [];
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
      {hasRange(facets?.price) && (
        <RangeField
          label="Price"
          unit="€"
          bounds={facets!.price}
          min={minPrice}
          max={maxPrice}
          setMin={setMinPrice}
          setMax={setMaxPrice}
        />
      )}
      {hasRange(facets?.areaSqm) && (
        <RangeField
          label="Surface area"
          unit="m²"
          bounds={facets!.areaSqm!}
          min={minArea}
          max={maxArea}
          setMin={setMinArea}
          setMax={setMaxArea}
        />
      )}
      {hasRange(facets?.landAre) && (
        <RangeField
          label="Land area"
          unit="ar"
          bounds={facets!.landAre!}
          min={minLand}
          max={maxLand}
          setMin={setMinLand}
          setMax={setMaxLand}
        />
      )}
      {hasRange(facets?.floors) && (
        <RangeField
          label="Floors"
          bounds={facets!.floors!}
          min={minFloors}
          max={maxFloors}
          setMin={setMinFloors}
          setMax={setMaxFloors}
        />
      )}
      {districtOptions.length > 0 && (
        <MultiSelectGroupVertical
          label="District"
          values={districts}
          setValues={setDistricts}
          options={districtOptions}
          {...(municipalityMembers.length > 0
            ? { groups: [{ label: 'Chișinău (municipality)', members: municipalityMembers }] }
            : {})}
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

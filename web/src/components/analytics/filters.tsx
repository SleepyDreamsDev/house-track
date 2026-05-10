import React from 'react';
import { Input } from '@/components/ui/Input.js';
import { fmt } from '@/lib/format.js';
import { roomsBucket, type RoomsBucket } from '@/lib/listing-type.js';
import { DIST_COLORS } from './types.js';

export const FilterGroupVertical: React.FC<{
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

// Multi-select chip group. Empty `values` array means "all". Clicking a chip
// toggles it; clicking "All" clears the selection. Used for the District
// filter where operators want to compare e.g. Centru + Buiucani in one view.
export const MultiSelectGroupVertical: React.FC<{
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

export const Segmented: React.FC<{
  options: string[];
  value: string;
  setValue: (v: string) => void;
}> = ({ options, value, setValue }) => (
  <div className="inline-flex rounded-md bg-neutral-100 p-0.5">
    {options.map((o) => {
      const active = value === o;
      return (
        <button
          key={o}
          onClick={() => setValue(o)}
          className={`rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium ${
            active
              ? 'bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200/60'
              : 'text-neutral-500 hover:text-neutral-900'
          }`}
        >
          {o}
        </button>
      );
    })}
  </div>
);

export const Legend: React.FC<{ districts: string[] }> = ({ districts }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
    {districts.map((d) => (
      <span key={d} className="inline-flex items-center gap-1">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: DIST_COLORS[d] ?? '#0f766e' }}
        />
        <span className="text-neutral-600">{d}</span>
      </span>
    ))}
  </div>
);

const PRICE_MAX_FALLBACK = 250000;
const PRICE_MIN_FALLBACK = 0;

export interface AnalyticsFacets {
  districts: string[];
  types: string[];
  roomsValues: number[];
  price: { min: number | null; max: number | null };
}

export interface AnalyticsFilterRailProps {
  q: string;
  setQ: (v: string) => void;
  maxPrice: number;
  setMaxPrice: (v: number) => void;
  districts: string[];
  setDistricts: (v: string[]) => void;
  type: string;
  setType: (v: string) => void;
  rooms: string;
  setRooms: (v: string) => void;
  facets: AnalyticsFacets | undefined;
  extraSlot?: React.ReactNode;
}

// Derive the rooms-bucket option list from observed roomsValues so the rail
// only offers buckets that have any listings backing them.
function bucketsFromFacets(roomsValues: number[]): RoomsBucket[] {
  const set = new Set<RoomsBucket>();
  for (const r of roomsValues) set.add(roomsBucket(r));
  return (['1–2', '3', '4', '5+'] as RoomsBucket[]).filter((b) => set.has(b));
}

export const AnalyticsFilterRail: React.FC<AnalyticsFilterRailProps> = ({
  q,
  setQ,
  maxPrice,
  setMaxPrice,
  districts,
  setDistricts,
  type,
  setType,
  rooms,
  setRooms,
  facets,
  extraSlot,
}) => {
  const priceMax = facets?.price?.max ?? PRICE_MAX_FALLBACK;
  const priceMin = facets?.price?.min ?? PRICE_MIN_FALLBACK;
  const districtOptions = facets?.districts ?? [];
  const types = facets?.types ?? [];
  const buckets = bucketsFromFacets(facets?.roomsValues ?? []);

  return (
    <div className="space-y-4 text-[13px]" data-testid="analytics-filter-rail">
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
          placeholder="Title…"
          aria-label="Search listings"
        />
      </div>
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
      <MultiSelectGroupVertical
        label="District"
        values={districts}
        setValues={setDistricts}
        options={districtOptions}
      />
      <FilterGroupVertical label="Property type" value={type} setValue={setType} options={types} />
      <FilterGroupVertical label="Rooms" value={rooms} setValue={setRooms} options={buckets} />
      {extraSlot}
    </div>
  );
};

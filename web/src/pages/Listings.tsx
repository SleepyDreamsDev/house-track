import React, { useState } from 'react';
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
  title: string;
  priceEur: number;
  priceWas?: number;
  areaSqm: number;
  landSqm?: number;
  rooms: number | null;
  floors?: number;
  yearBuilt?: number;
  district: string;
  street?: string;
  firstSeenAt: string;
  snapshots?: number;
  flags?: string[];
  isNew?: boolean;
}

const DISTRICTS = ['all', 'Buiucani', 'Botanica', 'Centru', 'Ciocana', 'Durlești', 'Râșcani'];

export const Listings: React.FC = () => {
  const [q, setQ] = useState('');
  const [maxPrice, setMaxPrice] = useState(250000);
  const [district, setDistrict] = useState('all');
  const [sort, setSort] = useState<'newest' | 'price' | 'eurm2'>('newest');
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<{ listings: Listing[]; total: number }>({
    queryKey: ['listings', { q, maxPrice, district, sort }],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q) p.append('q', q);
      if (maxPrice) p.append('maxPrice', String(maxPrice));
      if (district !== 'all') p.append('district', district);
      p.append('sort', sort);
      p.append('limit', '50');
      return apiCall(`/listings?${p}`);
    },
  });

  return (
    <div data-screen-label="Houses">
      <PageHeader
        title="Houses"
        subtitle={`${data?.total ?? '…'} listings · €${maxPrice.toLocaleString()} max`}
        actions={
          <Button
            variant="secondary"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['listings'] })}
          >
            Refresh
          </Button>
        }
      />

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
                min={50000}
                max={250000}
                step={5000}
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
                {DISTRICTS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDistrict(d)}
                    className={`w-full text-left rounded-sm px-2 py-1.5 text-sm transition-colors ${district === d ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
                  >
                    {d === 'all' ? 'All districts' : d}
                  </button>
                ))}
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
            <span className="text-xs text-neutral-400">{data?.listings?.length ?? 0} results</span>
          </div>

          {isLoading && <p className="text-sm text-neutral-400">Loading…</p>}
          {error && <p className="text-sm text-error">Error loading listings</p>}
          {data?.listings?.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}
        </div>
      </div>
    </div>
  );
};

const ListingCard: React.FC<{ l: Listing }> = ({ l }) => {
  const drop = l.priceWas ? Math.round((1 - l.priceEur / l.priceWas) * 100) : null;
  const eurm2 = l.areaSqm ? Math.round(l.priceEur / l.areaSqm) : 0;
  return (
    <div className="grid grid-cols-[120px_1fr_auto] gap-4 rounded-sm bg-white p-3 border border-neutral-200">
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
        <Button size="sm" variant="secondary">
          Open
        </Button>
      </div>
    </div>
  );
};

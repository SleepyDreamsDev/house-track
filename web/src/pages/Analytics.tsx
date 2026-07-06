import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { KStat } from '@/components/ui/KStat.js';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader.js';
import { Tabs, TabPanel } from '@/components/ui/Tabs.js';
import { apiCall } from '@/lib/api.js';
import { bucketToRoomsValues, type RoomsBucket } from '@/lib/listing-type.js';
import {
  type BestBuyRow,
  type MotivatedSellerRow,
  type OverviewResponse,
  type PriceDropRow,
} from '@/components/analytics/types.js';
import { Legend, Segmented } from '@/components/analytics/filters.js';
import { FilterRail, type FilterFacets } from '@/components/filters/FilterRail.js';
import { useBrowseFilters, type BrowseFilterState } from '@/lib/useBrowseFilters.js';
import {
  BestBuysTable,
  MotivatedSellersTable,
  PriceDropsTable,
} from '@/components/analytics/tables.js';
import { MultiLineChart } from '@/components/analytics/MultiLineChart.js';
import { Heatmap } from '@/components/analytics/Heatmap.js';
import { Scatter } from '@/components/analytics/Scatter.js';
import { FlowChart } from '@/components/analytics/FlowChart.js';
import { DOMHistogram } from '@/components/analytics/DOMHistogram.js';

type TabId = 'overview' | 'best-buys' | 'price-drops' | 'motivated-sellers';

const SUBTITLES: Record<TabId, string> = {
  overview: 'Market signals across active listings · 999.md · last 12 months',
  'best-buys': '50 listings ranked by deviation from district median, freshness, and recent drops',
  'price-drops': '50 listings whose price was reduced in the last 30 days',
  'motivated-sellers':
    '50 listings ranked by market overexposure, observed price cuts, and overpricing vs the hedonic model',
};

type DropPeriod = '7d' | '30d' | '90d';

interface ListingsFacetsResponse extends FilterFacets {
  total: number;
  rooms: { min: number | null; max: number | null };
  areaSqm: { min: number | null; max: number | null };
}

// Build the query string sent to /api/analytics/* — mirrors the filter set
// Listings sends to /api/listings, so an operator who narrowed Listings sees
// the same slice when they switch tabs.
function buildQueryParams(state: BrowseFilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.minPrice != null) p.set('minPrice', String(state.minPrice));
  if (state.maxPrice != null) p.set('maxPrice', String(state.maxPrice));
  if (state.minArea != null) p.set('minAreaSqm', String(state.minArea));
  if (state.maxArea != null) p.set('maxAreaSqm', String(state.maxArea));
  if (state.minLand != null) p.set('minLandAre', String(state.minLand));
  if (state.maxLand != null) p.set('maxLandAre', String(state.maxLand));
  if (state.minFloors != null) p.set('minFloors', String(state.minFloors));
  if (state.maxFloors != null) p.set('maxFloors', String(state.maxFloors));
  if (state.districts.length > 0) p.set('district', state.districts.join(','));
  if (state.sectors.length > 0) p.set('sector', state.sectors.join(','));
  if (state.type !== 'all') p.set('type', state.type);
  if (state.rooms !== 'all') {
    // Bucket → inclusive min/max the backend honors. '5+' is open-ended (no max).
    const values = bucketToRoomsValues(state.rooms as RoomsBucket);
    const min = values[0];
    const max = values[values.length - 1];
    if (min != null) p.set('minRooms', String(min));
    if (state.rooms !== '5+' && max != null) p.set('maxRooms', String(max));
  }
  if (state.favoritesOnly) p.set('favorite', 'true');
  if (state.showExcluded) p.set('includeExcluded', 'true');
  return p;
}

const TAB_IDS: readonly TabId[] = ['overview', 'best-buys', 'price-drops', 'motivated-sellers'];

export const Analytics: React.FC = () => {
  // Tab lives in the URL (?tab=best-buys) so a round-trip to a listing and back
  // returns to the same tab, and the tab is shareable/deep-linkable.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabId = TAB_IDS.includes(tabParam as TabId) ? (tabParam as TabId) : 'overview';
  const setTab = (t: TabId) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === 'overview') next.delete('tab');
        else next.set('tab', t);
        return next;
      },
      { replace: true },
    );
  const [dropPeriod, setDropPeriod] = useState<DropPeriod>('30d');

  const { data: facets } = useQuery<ListingsFacetsResponse>({
    queryKey: ['listings-facets'],
    queryFn: () => apiCall<ListingsFacetsResponse>('/listings/facets'),
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
  } = state;

  const districtsKey = districts.join(',');
  const sectorsKey = sectors.join(',');
  const queryParams = useMemo(
    () => buildQueryParams(state).toString(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
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
      favoritesOnly,
      showExcluded,
    ],
  );

  const overviewQ = useQuery<OverviewResponse>({
    queryKey: ['analytics', 'overview', queryParams],
    queryFn: () =>
      apiCall<OverviewResponse>(
        queryParams ? `/analytics/overview?${queryParams}` : '/analytics/overview',
      ),
  });

  const bestBuysQ = useQuery<BestBuyRow[]>({
    queryKey: ['analytics', 'best-buys', queryParams],
    queryFn: () =>
      apiCall<BestBuyRow[]>(
        queryParams ? `/analytics/best-buys?${queryParams}` : '/analytics/best-buys',
      ),
    enabled: tab === 'best-buys',
  });

  const priceDropsQ = useQuery<PriceDropRow[]>({
    queryKey: ['analytics', 'price-drops', dropPeriod, queryParams],
    queryFn: () => {
      const p = new URLSearchParams(queryParams);
      p.set('period', dropPeriod);
      return apiCall<PriceDropRow[]>(`/analytics/price-drops?${p.toString()}`);
    },
    enabled: tab === 'price-drops',
  });

  const motivatedQ = useQuery<MotivatedSellerRow[]>({
    queryKey: ['analytics', 'motivated-sellers', queryParams],
    queryFn: () =>
      apiCall<MotivatedSellerRow[]>(
        queryParams
          ? `/analytics/motivated-sellers?${queryParams}`
          : '/analytics/motivated-sellers',
      ),
    enabled: tab === 'motivated-sellers',
  });

  // Analytics omits hideMislabeled — the FilterRail then hides that toggle
  // (it filters rendered rows, which only the Listings view has).
  const railProps = {
    q,
    setQ: filters.setQ,
    minPrice,
    maxPrice,
    setMinPrice: filters.setMinPrice,
    setMaxPrice: filters.setMaxPrice,
    minArea,
    maxArea,
    setMinArea: filters.setMinArea,
    setMaxArea: filters.setMaxArea,
    minLand,
    maxLand,
    setMinLand: filters.setMinLand,
    setMaxLand: filters.setMaxLand,
    minFloors,
    maxFloors,
    setMinFloors: filters.setMinFloors,
    setMaxFloors: filters.setMaxFloors,
    districts,
    setDistricts: filters.setDistricts,
    sectors,
    setSectors: filters.setSectors,
    type,
    setType: filters.setType,
    rooms,
    setRooms: filters.setRooms,
    favoritesOnly,
    setFavoritesOnly: filters.setFavoritesOnly,
    showExcluded,
    setShowExcluded: filters.setShowExcluded,
    facets,
    onClearAll: filters.clearAll,
  };

  return (
    <div data-screen-label={`Analytics — ${tab}`}>
      <PageHeader
        title="Analytics"
        subtitle={SUBTITLES[tab]}
        actions={
          <>
            <Button variant="secondary">Export CSV</Button>
            <Button variant="secondary">Save view</Button>
          </>
        }
      />
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'best-buys', label: 'Best buys', count: bestBuysQ.data?.length ?? null },
          { id: 'price-drops', label: 'Price drops', count: priceDropsQ.data?.length ?? null },
          {
            id: 'motivated-sellers',
            label: 'Motivated sellers',
            count: motivatedQ.data?.length ?? null,
          },
        ]}
        active={tab}
        onChange={(id) => setTab(id as TabId)}
      />

      <TabPanel id="overview" label="Overview" active={tab === 'overview'}>
        <OverviewPanel
          data={overviewQ.data}
          railProps={railProps}
          districts={facets?.districts ?? []}
          onTab={setTab}
          activeDistricts={districts}
        />
      </TabPanel>

      <TabPanel id="best-buys" label="Best buys" active={tab === 'best-buys'}>
        <BestBuysPanel rows={bestBuysQ.data ?? []} railProps={railProps} />
      </TabPanel>

      <TabPanel id="price-drops" label="Price drops" active={tab === 'price-drops'}>
        <PriceDropsPanel
          rows={priceDropsQ.data ?? []}
          railProps={railProps}
          period={dropPeriod}
          setPeriod={setDropPeriod}
        />
      </TabPanel>

      <TabPanel
        id="motivated-sellers"
        label="Motivated sellers"
        active={tab === 'motivated-sellers'}
      >
        <MotivatedSellersPanel rows={motivatedQ.data ?? []} railProps={railProps} />
      </TabPanel>
    </div>
  );
};

type RailProps = Parameters<typeof FilterRail>[0];

const OverviewPanel: React.FC<{
  data: OverviewResponse | undefined;
  railProps: Omit<RailProps, 'extraSlot'>;
  districts: string[];
  activeDistricts: string[];
  onTab: (t: TabId) => void;
}> = ({ data, railProps, districts, activeDistricts, onTab }) => {
  const kpis = data?.kpis;
  const trendByDistrict = data?.trendByDistrict ?? {};
  const series =
    activeDistricts.length === 0
      ? trendByDistrict
      : Object.fromEntries(
          activeDistricts.filter((d) => trendByDistrict[d]).map((d) => [d, trendByDistrict[d]!]),
        );
  // Surface selected districts that produced no trend data so the legend
  // shrinking doesn't look like a chart bug — operator selected Buiucani
  // but the response has no Buiucani key (zero qualifying listings in
  // the slice).
  const missingDistricts =
    data && activeDistricts.length > 0 ? activeDistricts.filter((d) => !trendByDistrict[d]) : [];
  const heatmapDistricts = Object.keys(data?.heatmap ?? {});
  const heatmapBuckets = ['1–2', '3', '4', '5+'];

  return (
    <div>
      <Card className="!p-0 mb-5">
        <div className="grid grid-cols-5 divide-x divide-neutral-200">
          <div className="p-4">
            <KStat
              label="Median €/m²"
              value={kpis ? `€${kpis.medianEurPerSqm.toLocaleString('en-US')}` : '—'}
              hint="all active"
              tone="accent"
            />
          </div>
          <div className="p-4">
            <KStat label="Active inventory" value={kpis?.activeInventory ?? 0} />
          </div>
          <div className="p-4">
            <KStat label="Median DOM" value={kpis ? `${kpis.medianDomDays}d` : '—'} />
          </div>
          <div className="p-4">
            <KStat
              label="Best deals"
              value={kpis?.bestDealsCount ?? 0}
              hint="≥ 15% under district median"
            />
          </div>
          <div className="p-4">
            <KStat label="Recent drops" value={kpis?.recentDropsCount ?? 0} hint="last 30 days" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[260px_1fr] gap-5 mb-5">
        <Card className="self-start">
          <FilterRail {...railProps} />
        </Card>

        <div className="space-y-5">
          <Card>
            <SectionHeader
              title="€/m² trend by district"
              hint="last 12 months"
              right={<Legend districts={districts} />}
            />
            <MultiLineChart series={series} months={data?.months ?? []} />
            {missingDistricts.length > 0 && (
              <p className="mt-2 text-[11px] text-neutral-500">
                No trend data for {missingDistricts.join(', ')} in the current filter slice.
              </p>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-5">
            <Card>
              <SectionHeader title="Inventory & flow" hint="new vs gone, weekly" />
              <FlowChart
                inventory12w={data?.inventory12w ?? []}
                newPerWeek={data?.newPerWeek ?? []}
                gonePerWeek={data?.gonePerWeek ?? []}
              />
            </Card>
            <Card>
              <SectionHeader title="Days on market" />
              <DOMHistogram buckets={data?.domBuckets ?? []} />
            </Card>
          </div>

          <Card>
            <SectionHeader title="Price vs area" hint="active listings · median band ±15%" />
            <Scatter data={data?.scatter ?? []} />
            <p className="mt-2 text-[11px] text-neutral-500">
              Points well below the dashed line are candidates — find them ranked under{' '}
              <button
                onClick={() => onTab('best-buys')}
                className="underline text-teal-700 hover:text-teal-800"
              >
                Best buys
              </button>
              .
            </p>
          </Card>

          <Card>
            <SectionHeader title="€/m² heatmap" hint="district × room count · current" />
            <Heatmap
              data={data?.heatmap ?? {}}
              districts={heatmapDistricts}
              roomBuckets={heatmapBuckets}
            />
          </Card>
        </div>
      </div>
    </div>
  );
};

const BEST_BUY_PRESETS: Record<string, { key: string; dir: 'asc' | 'desc' }> = {
  Score: { key: 'score', dir: 'desc' },
  Discount: { key: 'discount', dir: 'desc' },
  Newest: { key: 'daysOnMkt', dir: 'asc' },
  '€/m²': { key: 'eurPerSqm', dir: 'asc' },
};

const BestBuysPanel: React.FC<{
  rows: BestBuyRow[];
  railProps: Omit<RailProps, 'extraSlot'>;
}> = ({ rows, railProps }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invalidateBestBuys = () =>
    queryClient.invalidateQueries({ queryKey: ['analytics', 'best-buys'] });
  const toggleFavorite = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      apiCall(`/listings/${id}/watchlist`, {
        method: 'PUT',
        body: JSON.stringify({ watchlist: next }),
      }),
    onSuccess: invalidateBestBuys,
  });
  const toggleExclude = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      apiCall(`/listings/${id}/excluded`, {
        method: 'PUT',
        body: JSON.stringify({ excluded: next }),
      }),
    onSuccess: invalidateBestBuys,
  });

  const [columnSort, setColumnSort] = useState<{ key: string; dir: 'asc' | 'desc' }>(
    BEST_BUY_PRESETS.Score!,
  );
  const sort =
    Object.entries(BEST_BUY_PRESETS).find(
      ([, p]) => p.key === columnSort.key && p.dir === columnSort.dir,
    )?.[0] ?? '';
  const setSort = (label: string) => {
    const preset = BEST_BUY_PRESETS[label];
    if (preset) setColumnSort(preset);
  };

  const strongCandidates = rows.filter((r) => r.discount >= 15).length;
  const belowMedian = rows.filter((r) => r.discount >= 5).length;
  const avgDiscount = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.discount, 0) / rows.length)
    : 0;
  const withDrop = rows.filter((r) => r.priceDrop).length;

  return (
    <div>
      <Card className="!p-0 mb-5">
        <div className="grid grid-cols-4 divide-x divide-neutral-200">
          <div className="p-4">
            <KStat label="Below median" value={belowMedian} hint="discount ≥ 5%" />
          </div>
          <div className="p-4">
            <KStat
              label="Strong candidates"
              value={strongCandidates}
              tone="accent"
              hint="≥ 15% under median"
            />
          </div>
          <div className="p-4">
            <KStat label="Avg discount" value={`−${avgDiscount}%`} hint="vs district median" />
          </div>
          <div className="p-4">
            <KStat label="With recent drop" value={withDrop} hint={`of ${rows.length}`} />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[260px_1fr] gap-5">
        <Card className="self-start">
          <FilterRail {...railProps} />
        </Card>

        <Card>
          <SectionHeader
            title={`Best options to buy now — ${rows.length}`}
            hint="ranked by composite score"
            right={
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-neutral-500">Sort</span>
                <Segmented
                  options={['Score', 'Discount', 'Newest', '€/m²']}
                  value={sort}
                  setValue={setSort}
                />
              </div>
            }
          />
          <BestBuysTable
            rows={rows}
            fullCols
            sort={columnSort}
            onSortChange={setColumnSort}
            onToggleFavorite={(id, next) => toggleFavorite.mutate({ id, next })}
            onToggleExclude={(id, next) => toggleExclude.mutate({ id, next })}
            onOpenListing={(id) =>
              navigate(`/listings?highlight=${encodeURIComponent(id)}&from=best-buys`)
            }
          />
        </Card>
      </div>
    </div>
  );
};

const MOTIVATED_PRESETS: Record<string, { key: string; dir: 'asc' | 'desc' }> = {
  Score: { key: 'score', dir: 'desc' },
  DOM: { key: 'daysOnMkt', dir: 'desc' },
  Cuts: { key: 'cuts', dir: 'desc' },
  'vs model': { key: 'residualPct', dir: 'desc' },
};

const MotivatedSellersPanel: React.FC<{
  rows: MotivatedSellerRow[];
  railProps: Omit<RailProps, 'extraSlot'>;
}> = ({ rows, railProps }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['analytics', 'motivated-sellers'] });
  const toggleFavorite = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      apiCall(`/listings/${id}/watchlist`, {
        method: 'PUT',
        body: JSON.stringify({ watchlist: next }),
      }),
    onSuccess: invalidate,
  });
  const toggleExclude = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      apiCall(`/listings/${id}/excluded`, {
        method: 'PUT',
        body: JSON.stringify({ excluded: next }),
      }),
    onSuccess: invalidate,
  });

  const [columnSort, setColumnSort] = useState<{ key: string; dir: 'asc' | 'desc' }>(
    MOTIVATED_PRESETS.Score!,
  );
  const sort =
    Object.entries(MOTIVATED_PRESETS).find(
      ([, p]) => p.key === columnSort.key && p.dir === columnSort.dir,
    )?.[0] ?? '';
  const setSort = (label: string) => {
    const preset = MOTIVATED_PRESETS[label];
    if (preset) setColumnSort(preset);
  };

  const withCuts = rows.filter((r) => r.cuts > 0).length;
  const overpriced = rows.filter((r) => r.residualPct != null && r.residualPct > 0.1).length;
  const overexposed = rows.filter((r) => r.daysOnMkt > Math.max(r.domMedianDistrict, 1)).length;
  const medianCut = rows.length
    ? [...rows.map((r) => r.totalCutPct)].sort((a, b) => a - b)[Math.floor(rows.length / 2)]!
    : 0;

  return (
    <div>
      <Card className="!p-0 mb-5">
        <div className="grid grid-cols-4 divide-x divide-neutral-200">
          <div className="p-4">
            <KStat label="With price cuts" value={withCuts} tone="accent" hint="≥1 observed cut" />
          </div>
          <div className="p-4">
            <KStat label="Over district DOM" value={overexposed} hint="stale vs peers" />
          </div>
          <div className="p-4">
            <KStat label="Overpriced" value={overpriced} hint="> +10% vs model" />
          </div>
          <div className="p-4">
            <KStat label="Median total cut" value={`${medianCut}%`} hint="first ask → now" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[260px_1fr] gap-5">
        <Card className="self-start">
          <FilterRail {...railProps} />
        </Card>

        <Card>
          <SectionHeader
            title={`Motivated sellers — ${rows.length}`}
            hint="ranked by exposure, capitulation, and overpricing"
            right={
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-neutral-500">Sort</span>
                <Segmented
                  options={['Score', 'DOM', 'Cuts', 'vs model']}
                  value={sort}
                  setValue={setSort}
                />
              </div>
            }
          />
          <MotivatedSellersTable
            rows={rows}
            sort={columnSort}
            onSortChange={setColumnSort}
            onToggleFavorite={(id, next) => toggleFavorite.mutate({ id, next })}
            onToggleExclude={(id, next) => toggleExclude.mutate({ id, next })}
            onOpenListing={(id) =>
              navigate(`/listings?highlight=${encodeURIComponent(id)}&from=motivated-sellers`)
            }
          />
        </Card>
      </div>
    </div>
  );
};

const PRICE_DROP_PRESETS: Record<string, { key: string; dir: 'asc' | 'desc' }> = {
  '% drop': { key: 'dropPct', dir: 'desc' },
  '€ drop': { key: 'dropEur', dir: 'desc' },
  Newest: { key: 'when', dir: 'asc' },
};

const PriceDropsPanel: React.FC<{
  rows: PriceDropRow[];
  railProps: Omit<RailProps, 'extraSlot'>;
  period: DropPeriod;
  setPeriod: (v: DropPeriod) => void;
}> = ({ rows, railProps, period, setPeriod }) => {
  const [columnSort, setColumnSort] = useState<{ key: string; dir: 'asc' | 'desc' }>(
    PRICE_DROP_PRESETS['% drop']!,
  );
  const sort =
    Object.entries(PRICE_DROP_PRESETS).find(
      ([, p]) => p.key === columnSort.key && p.dir === columnSort.dir,
    )?.[0] ?? '';
  const setSort = (label: string) => {
    const preset = PRICE_DROP_PRESETS[label];
    if (preset) setColumnSort(preset);
  };

  const totalCutK = rows.length ? Math.round(rows.reduce((s, r) => s + r.dropEur, 0) / 1000) : 0;
  const thisWeek = rows.filter((r) => parseInt(r.when) <= 7).length;
  const medianDrop = rows.length
    ? rows.map((r) => r.dropPct).sort((a, b) => a - b)[Math.floor(rows.length / 2)]!
    : 0;

  const periodSlot = (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        Period
      </div>
      <Segmented
        options={['7d', '30d', '90d']}
        value={period}
        setValue={(v) => setPeriod(v as DropPeriod)}
      />
    </div>
  );

  return (
    <div>
      <Card className="!p-0 mb-5">
        <div className="grid grid-cols-4 divide-x divide-neutral-200">
          <div className="p-4">
            <KStat label={`Drops in ${period}`} value={rows.length} tone="accent" />
          </div>
          <div className="p-4">
            <KStat label="Median drop" value={`${medianDrop}%`} hint="of original price" />
          </div>
          <div className="p-4">
            <KStat label="Total cut" value={`€${totalCutK}k`} hint="across all drops" />
          </div>
          <div className="p-4">
            <KStat label="Drops this week" value={thisWeek} hint="fresh signal" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[260px_1fr] gap-5">
        <Card className="self-start">
          <FilterRail {...railProps} extraSlot={periodSlot} />
        </Card>

        <Card>
          <SectionHeader
            title={`Recent price drops — ${rows.length}`}
            hint="last 30 days · ranked"
            right={
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-neutral-500">Sort</span>
                <Segmented
                  options={['% drop', '€ drop', 'Newest']}
                  value={sort}
                  setValue={setSort}
                />
              </div>
            }
          />
          <PriceDropsTable rows={rows} fullCols sort={columnSort} onSortChange={setColumnSort} />
        </Card>
      </div>
    </div>
  );
};

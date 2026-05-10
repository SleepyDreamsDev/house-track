import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { KStat } from '@/components/ui/KStat.js';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader.js';
import { Tabs, TabPanel } from '@/components/ui/Tabs.js';
import { apiCall } from '@/lib/api.js';
import { bucketToRoomsValues, type RoomsBucket } from '@/lib/listing-type.js';
import {
  type BestBuyRow,
  type OverviewResponse,
  type PriceDropRow,
} from '@/components/analytics/types.js';
import {
  AnalyticsFilterRail,
  type AnalyticsFacets,
  Legend,
  Segmented,
} from '@/components/analytics/filters.js';
import { BestBuysTable, PriceDropsTable } from '@/components/analytics/tables.js';
import { MultiLineChart } from '@/components/analytics/MultiLineChart.js';
import { Heatmap } from '@/components/analytics/Heatmap.js';
import { Scatter } from '@/components/analytics/Scatter.js';
import { FlowChart } from '@/components/analytics/FlowChart.js';
import { DOMHistogram } from '@/components/analytics/DOMHistogram.js';

type TabId = 'overview' | 'best-buys' | 'price-drops';

const SUBTITLES: Record<TabId, string> = {
  overview: 'Market signals across active listings · 999.md · last 12 months',
  'best-buys': '50 listings ranked by deviation from district median, freshness, and recent drops',
  'price-drops': '50 listings whose price was reduced in the last 30 days',
};

type DropPeriod = '7d' | '30d' | '90d';

interface ListingsFacetsResponse extends AnalyticsFacets {
  total: number;
  rooms: { min: number | null; max: number | null };
  areaSqm: { min: number | null; max: number | null };
}

const PRICE_MAX_FALLBACK = 250000;

interface FilterState {
  q: string;
  maxPrice: number;
  district: string;
  type: string;
  rooms: string;
}

// Build the query string sent to /api/analytics/* — mirrors the filter set
// Listings sends to /api/listings, so an operator who narrowed Listings sees
// the same slice when they switch tabs.
function buildQueryParams(state: FilterState, priceMax: number): URLSearchParams {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.maxPrice < priceMax) p.set('maxPrice', String(state.maxPrice));
  if (state.district !== 'all') p.set('district', state.district);
  if (state.type !== 'all') p.set('type', state.type);
  if (state.rooms !== 'all') {
    const values = bucketToRoomsValues(state.rooms as RoomsBucket);
    // Backend takes a single rooms integer; our buckets like '1–2' span
    // multiple values. For now send the lowest-value match; future work can
    // teach the backend to take a range.
    if (values[0] != null) p.set('rooms', String(values[0]));
  }
  return p;
}

export const Analytics: React.FC = () => {
  const [tab, setTab] = useState<TabId>('overview');
  const [q, setQ] = useState('');
  const [maxPrice, setMaxPrice] = useState(PRICE_MAX_FALLBACK);
  const [district, setDistrict] = useState('all');
  const [type, setType] = useState('all');
  const [rooms, setRooms] = useState('all');
  const [dropPeriod, setDropPeriod] = useState<DropPeriod>('30d');

  const { data: facets } = useQuery<ListingsFacetsResponse>({
    queryKey: ['listings-facets'],
    queryFn: () => apiCall<ListingsFacetsResponse>('/listings/facets'),
  });
  const priceMax = facets?.price?.max ?? PRICE_MAX_FALLBACK;

  // Snap maxPrice to the data's max once facets resolve, but only if the
  // user hasn't already moved the slider past it. Same pattern as Listings.
  useEffect(() => {
    if (facets && maxPrice > priceMax) setMaxPrice(priceMax);
    // initial-only clamp; intentionally exclude maxPrice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets]);

  const filterState: FilterState = { q, maxPrice, district, type, rooms };
  const queryParams = useMemo(
    () => buildQueryParams(filterState, priceMax).toString(),
    // queryParams depends only on flat values, so spread them
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, maxPrice, district, type, rooms, priceMax],
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

  const railProps = {
    q,
    setQ,
    maxPrice,
    setMaxPrice,
    district,
    setDistrict,
    type,
    setType,
    rooms,
    setRooms,
    facets,
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
          activeDistrict={district}
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
    </div>
  );
};

type RailProps = Parameters<typeof AnalyticsFilterRail>[0];

const OverviewPanel: React.FC<{
  data: OverviewResponse | undefined;
  railProps: Omit<RailProps, 'extraSlot'>;
  districts: string[];
  activeDistrict: string;
  onTab: (t: TabId) => void;
}> = ({ data, railProps, districts, activeDistrict, onTab }) => {
  const kpis = data?.kpis;
  const series =
    activeDistrict === 'all'
      ? (data?.trendByDistrict ?? {})
      : data?.trendByDistrict[activeDistrict]
        ? { [activeDistrict]: data.trendByDistrict[activeDistrict]! }
        : {};
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
          <AnalyticsFilterRail {...railProps} />
        </Card>

        <div className="space-y-5">
          <Card>
            <SectionHeader
              title="€/m² trend by district"
              hint="last 12 months"
              right={<Legend districts={districts} />}
            />
            <MultiLineChart series={series} months={data?.months ?? []} />
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

const BestBuysPanel: React.FC<{
  rows: BestBuyRow[];
  railProps: Omit<RailProps, 'extraSlot'>;
}> = ({ rows, railProps }) => {
  const [sort, setSort] = useState('Score');
  const sorted = useMemo(() => {
    const s = [...rows];
    if (sort === 'Discount') s.sort((a, b) => b.discount - a.discount);
    else if (sort === '€/m²') s.sort((a, b) => a.eurPerSqm - b.eurPerSqm);
    else if (sort === 'Newest') s.sort((a, b) => a.daysOnMkt - b.daysOnMkt);
    else s.sort((a, b) => b.score - a.score);
    return s;
  }, [rows, sort]);

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
          <AnalyticsFilterRail {...railProps} />
        </Card>

        <Card>
          <SectionHeader
            title={`Best options to buy now — ${sorted.length} of ${rows.length}`}
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
          <BestBuysTable rows={sorted} fullCols />
        </Card>
      </div>
    </div>
  );
};

const PriceDropsPanel: React.FC<{
  rows: PriceDropRow[];
  railProps: Omit<RailProps, 'extraSlot'>;
  period: DropPeriod;
  setPeriod: (v: DropPeriod) => void;
}> = ({ rows, railProps, period, setPeriod }) => {
  const [sort, setSort] = useState('% drop');
  const sorted = useMemo(() => {
    const s = [...rows];
    if (sort === '€ drop') s.sort((a, b) => b.dropEur - a.dropEur);
    else if (sort === 'Newest') s.sort((a, b) => parseInt(a.when) - parseInt(b.when));
    else s.sort((a, b) => b.dropPct - a.dropPct);
    return s;
  }, [rows, sort]);

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
          <AnalyticsFilterRail {...railProps} extraSlot={periodSlot} />
        </Card>

        <Card>
          <SectionHeader
            title={`Recent price drops — ${sorted.length} of ${rows.length}`}
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
          <PriceDropsTable rows={sorted} fullCols />
        </Card>
      </div>
    </div>
  );
};

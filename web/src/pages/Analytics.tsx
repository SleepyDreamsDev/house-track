import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { KStat } from '@/components/ui/KStat.js';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader.js';
import { Tabs, TabPanel } from '@/components/ui/Tabs.js';
import { apiCall } from '@/lib/api.js';
import {
  A_DISTRICTS,
  A_ROOMS,
  A_TYPES,
  type BestBuyRow,
  type OverviewResponse,
  type PriceDropRow,
} from '@/components/analytics/types.js';
import { FilterGroupVertical, Legend, Segmented } from '@/components/analytics/filters.js';
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

export const Analytics: React.FC = () => {
  const [tab, setTab] = useState<TabId>('overview');
  const [region, setRegion] = useState('all');
  const [type, setType] = useState('all');
  const [rooms, setRooms] = useState('all');
  const [dropPeriod, setDropPeriod] = useState<DropPeriod>('30d');

  const overviewQ = useQuery<OverviewResponse>({
    queryKey: ['analytics', 'overview'],
    queryFn: () => apiCall<OverviewResponse>('/analytics/overview'),
  });

  const bestBuysQ = useQuery<BestBuyRow[]>({
    queryKey: ['analytics', 'best-buys'],
    queryFn: () => apiCall<BestBuyRow[]>('/analytics/best-buys'),
    enabled: tab === 'best-buys',
  });

  const priceDropsQ = useQuery<PriceDropRow[]>({
    queryKey: ['analytics', 'price-drops', dropPeriod],
    queryFn: () => apiCall<PriceDropRow[]>(`/analytics/price-drops?period=${dropPeriod}`),
    enabled: tab === 'price-drops',
  });

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
          region={region}
          setRegion={setRegion}
          type={type}
          setType={setType}
          rooms={rooms}
          setRooms={setRooms}
          onTab={setTab}
        />
      </TabPanel>

      <TabPanel id="best-buys" label="Best buys" active={tab === 'best-buys'}>
        <BestBuysPanel
          rows={bestBuysQ.data ?? []}
          region={region}
          setRegion={setRegion}
          type={type}
          setType={setType}
          rooms={rooms}
          setRooms={setRooms}
        />
      </TabPanel>

      <TabPanel id="price-drops" label="Price drops" active={tab === 'price-drops'}>
        <PriceDropsPanel
          rows={priceDropsQ.data ?? []}
          region={region}
          setRegion={setRegion}
          type={type}
          setType={setType}
          rooms={rooms}
          setRooms={setRooms}
          period={dropPeriod}
          setPeriod={setDropPeriod}
        />
      </TabPanel>
    </div>
  );
};

const OverviewPanel: React.FC<{
  data: OverviewResponse | undefined;
  region: string;
  setRegion: (v: string) => void;
  type: string;
  setType: (v: string) => void;
  rooms: string;
  setRooms: (v: string) => void;
  onTab: (t: TabId) => void;
}> = ({ data, region, setRegion, type, setType, rooms, setRooms, onTab }) => {
  const kpis = data?.kpis;
  const series =
    region === 'all'
      ? (data?.trendByDistrict ?? {})
      : data?.trendByDistrict[region]
        ? { [region]: data.trendByDistrict[region]! }
        : {};

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
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
            Filters
          </div>
          <div className="space-y-4 text-[13px]">
            <FilterGroupVertical
              label="Region"
              value={region}
              setValue={setRegion}
              options={['all', ...A_DISTRICTS]}
            />
            <FilterGroupVertical
              label="Property type"
              value={type}
              setValue={setType}
              options={['all', ...A_TYPES]}
            />
            <FilterGroupVertical
              label="Rooms"
              value={rooms}
              setValue={setRooms}
              options={['all', ...A_ROOMS]}
            />
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <SectionHeader
              title="€/m² trend by district"
              hint="last 12 months"
              right={<Legend />}
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
            <Heatmap data={data?.heatmap ?? {}} />
          </Card>
        </div>
      </div>
    </div>
  );
};

const BestBuysPanel: React.FC<{
  rows: BestBuyRow[];
  region: string;
  setRegion: (v: string) => void;
  type: string;
  setType: (v: string) => void;
  rooms: string;
  setRooms: (v: string) => void;
}> = ({ rows, region, setRegion, type, setType, rooms, setRooms }) => {
  const [sort, setSort] = useState('Score');
  const filtered = useMemo(() => {
    let r = rows;
    if (region !== 'all') r = r.filter((x) => x.district === region);
    if (type !== 'all') r = r.filter((x) => x.type === type);
    const s = [...r];
    if (sort === 'Discount') s.sort((a, b) => b.discount - a.discount);
    else if (sort === '€/m²') s.sort((a, b) => a.eurPerSqm - b.eurPerSqm);
    else if (sort === 'Newest') s.sort((a, b) => a.daysOnMkt - b.daysOnMkt);
    else s.sort((a, b) => b.score - a.score);
    return s;
  }, [rows, region, type, sort]);

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
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
            Filters
          </div>
          <div className="space-y-4">
            <FilterGroupVertical
              label="Region"
              value={region}
              setValue={setRegion}
              options={['all', ...A_DISTRICTS]}
            />
            <FilterGroupVertical
              label="Property type"
              value={type}
              setValue={setType}
              options={['all', ...A_TYPES]}
            />
            <FilterGroupVertical
              label="Rooms"
              value={rooms}
              setValue={setRooms}
              options={['all', ...A_ROOMS]}
            />
          </div>
        </Card>

        <Card>
          <SectionHeader
            title={`Best options to buy now — ${filtered.length} of ${rows.length}`}
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
          <BestBuysTable rows={filtered} fullCols />
        </Card>
      </div>
    </div>
  );
};

const PriceDropsPanel: React.FC<{
  rows: PriceDropRow[];
  region: string;
  setRegion: (v: string) => void;
  type: string;
  setType: (v: string) => void;
  rooms: string;
  setRooms: (v: string) => void;
  period: DropPeriod;
  setPeriod: (v: DropPeriod) => void;
}> = ({ rows, region, setRegion, type, setType, rooms, setRooms, period, setPeriod }) => {
  const [sort, setSort] = useState('% drop');
  const filtered = useMemo(() => {
    let r = rows;
    if (region !== 'all') r = r.filter((x) => x.district === region);
    if (type !== 'all') r = r.filter((x) => x.type === type);
    const s = [...r];
    if (sort === '€ drop') s.sort((a, b) => b.dropEur - a.dropEur);
    else if (sort === 'Newest') s.sort((a, b) => parseInt(a.when) - parseInt(b.when));
    else s.sort((a, b) => b.dropPct - a.dropPct);
    return s;
  }, [rows, region, type, sort]);

  const totalCutK = rows.length ? Math.round(rows.reduce((s, r) => s + r.dropEur, 0) / 1000) : 0;
  const thisWeek = rows.filter((r) => parseInt(r.when) <= 7).length;
  const medianDrop = rows.length
    ? rows.map((r) => r.dropPct).sort((a, b) => a - b)[Math.floor(rows.length / 2)]!
    : 0;

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
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
            Filters
          </div>
          <div className="space-y-4">
            <FilterGroupVertical
              label="Region"
              value={region}
              setValue={setRegion}
              options={['all', ...A_DISTRICTS]}
            />
            <FilterGroupVertical
              label="Property type"
              value={type}
              setValue={setType}
              options={['all', ...A_TYPES]}
            />
            <FilterGroupVertical
              label="Rooms"
              value={rooms}
              setValue={setRooms}
              options={['all', ...A_ROOMS]}
            />
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
          </div>
        </Card>

        <Card>
          <SectionHeader
            title={`Recent price drops — ${filtered.length} of ${rows.length}`}
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
          <PriceDropsTable rows={filtered} fullCols />
        </Card>
      </div>
    </div>
  );
};

import { Hono } from 'hono';
import { getPrisma } from '../../db.js';

export const analyticsRouter = new Hono();

interface OverviewResponse {
  kpis: {
    medianEurPerSqm: number;
    activeInventory: number;
    medianDomDays: number;
    bestDealsCount: number;
    recentDropsCount: number;
  };
  trendByDistrict: Record<string, number[]>;
  months: string[];
  heatmap: Record<string, Record<string, number>>;
  domBuckets: { label: string; count: number; hot?: boolean; stale?: boolean }[];
  inventory12w: number[];
  newPerWeek: number[];
  gonePerWeek: number[];
  scatter: { id: string; areaSqm: number; priceK: number; district: string }[];
}

interface BestBuyRow {
  id: string;
  title: string;
  district: string;
  type: string;
  priceEur: number;
  areaSqm: number;
  yearBuilt: number;
  daysOnMkt: number;
  eurPerSqm: number;
  medianEurPerSqm: number;
  discount: number;
  z: number;
  score: number;
  priceDrop: boolean;
  dropPct: number;
  rooms: number;
}

interface PriceDropRow {
  id: string;
  title: string;
  district: string;
  type: string;
  priceWas: number;
  priceEur: number;
  dropPct: number;
  dropEur: number;
  when: string;
}

function deriveType(title: string): string {
  if (/vil[ăa]/i.test(title)) return 'Villa';
  if (/townhouse/i.test(title)) return 'Townhouse';
  return 'House';
}

function roomsBucket(rooms: number | null): string {
  if (rooms == null) return '1–2';
  if (rooms <= 2) return '1–2';
  if (rooms === 3) return '3';
  if (rooms === 4) return '4';
  return '5+';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return (a + b) / 2;
  }
  return sorted[mid] ?? 0;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function relativeWhen(from: Date, now: Date): string {
  const diffMs = now.getTime() - from.getTime();
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 24) return `${Math.max(hours, 1)}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

analyticsRouter.get('/analytics/overview', async (c) => {
  const prisma = getPrisma();
  const now = new Date();

  const active = await prisma.listing.findMany({
    where: { active: true },
    select: {
      id: true,
      title: true,
      priceEur: true,
      areaSqm: true,
      rooms: true,
      district: true,
      firstSeenAt: true,
    },
  });

  const validForMedian = active.filter(
    (l): l is typeof l & { priceEur: number; areaSqm: number } =>
      l.priceEur != null && l.areaSqm != null && l.areaSqm > 0,
  );
  const medianEurPerSqm = Math.round(median(validForMedian.map((l) => l.priceEur / l.areaSqm)));

  const domDays = active.map((l) =>
    Math.max(0, Math.floor((now.getTime() - l.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000))),
  );
  const medianDomDays = Math.round(median(domDays));

  const domBuckets: OverviewResponse['domBuckets'] = [
    { label: '<7d', count: domDays.filter((d) => d < 7).length, hot: true },
    { label: '7–30d', count: domDays.filter((d) => d >= 7 && d < 30).length },
    { label: '30–90d', count: domDays.filter((d) => d >= 30 && d < 90).length },
    { label: '90+d', count: domDays.filter((d) => d >= 90).length, stale: true },
  ];

  const monthLabels: string[] = [];
  const monthBucketStarts: Date[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    monthBucketStarts.push(d);
    monthLabels.push(d.toLocaleString('en-US', { month: 'short' }));
  }

  const districts = Array.from(
    new Set(active.map((l) => l.district).filter((d): d is string => !!d)),
  );

  const trendByDistrict: Record<string, number[]> = {};
  for (const district of districts) {
    const series: number[] = [];
    for (let m = 0; m < 12; m++) {
      const start = monthBucketStarts[m];
      if (!start) continue;
      const end =
        m + 1 < 12
          ? monthBucketStarts[m + 1]
          : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const inBucket = active.filter(
        (l) =>
          l.district === district &&
          l.priceEur != null &&
          l.areaSqm != null &&
          l.areaSqm > 0 &&
          l.firstSeenAt >= start &&
          end != null &&
          l.firstSeenAt < end,
      );
      const eurPerSqms = inBucket.map((l) => (l.priceEur as number) / (l.areaSqm as number));
      series.push(Math.round(median(eurPerSqms)));
    }
    trendByDistrict[district] = series;
  }

  const heatmap: Record<string, Record<string, number>> = {};
  for (const l of active) {
    if (!l.district || l.priceEur == null || l.areaSqm == null || l.areaSqm <= 0) continue;
    const bucket = roomsBucket(l.rooms);
    const eurPerSqm = l.priceEur / l.areaSqm;
    if (!heatmap[l.district]) heatmap[l.district] = {};
    const districtMap = heatmap[l.district];
    if (!districtMap) continue;
    const existing = districtMap[bucket];
    districtMap[bucket] = existing == null ? eurPerSqm : (existing + eurPerSqm) / 2;
  }
  for (const district of Object.keys(heatmap)) {
    const map = heatmap[district];
    if (!map) continue;
    for (const bucket of Object.keys(map)) {
      const value = map[bucket];
      if (value != null) map[bucket] = Math.round(value);
    }
  }

  const inventory12w: number[] = [];
  const newPerWeek: number[] = [];
  const gonePerWeek: number[] = [];
  for (let w = 11; w >= 0; w--) {
    const weekStart = new Date(now.getTime() - (w + 1) * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);
    const newCount = active.filter(
      (l) => l.firstSeenAt >= weekStart && l.firstSeenAt < weekEnd,
    ).length;
    inventory12w.push(active.filter((l) => l.firstSeenAt < weekEnd).length);
    newPerWeek.push(newCount);
    gonePerWeek.push(0);
  }

  const scatterRecent = [...active]
    .sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime())
    .slice(0, 20)
    .filter(
      (l): l is typeof l & { priceEur: number; areaSqm: number; district: string } =>
        l.priceEur != null && l.areaSqm != null && l.district != null,
    )
    .map((l) => ({
      id: l.id,
      areaSqm: l.areaSqm,
      priceK: l.priceEur / 1000,
      district: l.district,
    }));

  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recentDropsCount = await prisma.listingSnapshot.count({
    where: { capturedAt: { gte: since30d } },
  });

  const body: OverviewResponse = {
    kpis: {
      medianEurPerSqm,
      activeInventory: active.length,
      medianDomDays,
      bestDealsCount: 0,
      recentDropsCount,
    },
    trendByDistrict,
    months: monthLabels,
    heatmap,
    domBuckets,
    inventory12w,
    newPerWeek,
    gonePerWeek,
    scatter: scatterRecent,
  };
  return c.json(body);
});

analyticsRouter.get('/analytics/best-buys', async (c) => {
  const prisma = getPrisma();
  const region = c.req.query('region');
  const type = c.req.query('type');
  const roomsParam = c.req.query('rooms');
  const roomsFilter = roomsParam ? Number.parseInt(roomsParam, 10) : undefined;

  const where: Parameters<typeof prisma.listing.findMany>[0] extends infer T
    ? T extends { where?: infer W }
      ? W
      : never
    : never = { active: true };
  if (region) (where as Record<string, unknown>).district = region;
  if (roomsFilter != null && !Number.isNaN(roomsFilter)) {
    (where as Record<string, unknown>).rooms = roomsFilter;
  }

  const listings = await prisma.listing.findMany({
    where,
    select: {
      id: true,
      title: true,
      priceEur: true,
      areaSqm: true,
      rooms: true,
      district: true,
      yearBuilt: true,
      firstSeenAt: true,
      snapshots: { orderBy: { capturedAt: 'asc' }, select: { priceEur: true, capturedAt: true } },
    },
  });

  const filtered = listings.filter((l) => {
    if (l.priceEur == null || l.areaSqm == null || l.areaSqm <= 0 || !l.district) return false;
    if (type) {
      if (deriveType(l.title) !== type) return false;
    }
    return true;
  });

  const byDistrict = new Map<string, number[]>();
  for (const l of filtered) {
    const arr = byDistrict.get(l.district as string) ?? [];
    arr.push((l.priceEur as number) / (l.areaSqm as number));
    byDistrict.set(l.district as string, arr);
  }
  const districtStats = new Map<string, { median: number; std: number }>();
  for (const [d, arr] of byDistrict.entries()) {
    districtStats.set(d, { median: median(arr), std: stddev(arr) });
  }

  const now = new Date();
  const rows: BestBuyRow[] = filtered.map((l) => {
    const eurPerSqm = (l.priceEur as number) / (l.areaSqm as number);
    const stats = districtStats.get(l.district as string) ?? { median: eurPerSqm, std: 1 };
    const safeStd = stats.std > 0 ? stats.std : 1;
    const z = (eurPerSqm - stats.median) / safeStd;
    const daysOnMkt = Math.max(
      0,
      Math.floor((now.getTime() - l.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000)),
    );

    let dropPct = 0;
    let priceDrop = false;
    if (l.snapshots.length >= 2) {
      const earliest = l.snapshots[0];
      const latest = l.snapshots[l.snapshots.length - 1];
      if (earliest && latest && earliest.priceEur != null && latest.priceEur != null) {
        dropPct = (1 - latest.priceEur / earliest.priceEur) * 100;
        if (dropPct >= 3) priceDrop = true;
      }
    }

    const freshnessBoost = daysOnMkt < 1 ? 0.4 : daysOnMkt < 7 ? 0.2 : 0;
    const score = -z + freshnessBoost + Math.abs(dropPct) * 4;
    const discount = stats.median > 0 ? (1 - eurPerSqm / stats.median) * 100 : 0;

    return {
      id: l.id,
      title: l.title,
      district: l.district as string,
      type: deriveType(l.title),
      priceEur: l.priceEur as number,
      areaSqm: l.areaSqm as number,
      yearBuilt: l.yearBuilt ?? 0,
      daysOnMkt,
      eurPerSqm: Math.round(eurPerSqm),
      medianEurPerSqm: Math.round(stats.median),
      discount: Math.round(discount * 10) / 10,
      z: Math.round(z * 100) / 100,
      score: Math.round(score * 100) / 100,
      priceDrop,
      dropPct: Math.round(dropPct * 10) / 10,
      rooms: l.rooms ?? 0,
    };
  });

  rows.sort((a, b) => b.score - a.score);
  return c.json(rows.slice(0, 50));
});

analyticsRouter.get('/analytics/price-drops', async (c) => {
  const prisma = getPrisma();
  const period = c.req.query('period') ?? '30d';
  const allowed: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
  if (!(period in allowed)) {
    return c.json({ error: 'invalid period' }, 400);
  }
  const days = allowed[period] as number;
  const region = c.req.query('region');
  const type = c.req.query('type');

  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const where: Record<string, unknown> = { active: true };
  if (region) where.district = region;

  const listings = await prisma.listing.findMany({
    where,
    select: {
      id: true,
      title: true,
      district: true,
      snapshots: {
        where: { capturedAt: { gte: since } },
        orderBy: { capturedAt: 'asc' },
        select: { priceEur: true, capturedAt: true },
      },
    },
  });

  const rows: PriceDropRow[] = [];
  for (const l of listings) {
    if (l.snapshots.length < 2) continue;
    const earliest = l.snapshots[0];
    const latest = l.snapshots[l.snapshots.length - 1];
    if (!earliest || !latest || earliest.priceEur == null || latest.priceEur == null) continue;

    const dropPct = (1 - latest.priceEur / earliest.priceEur) * 100;
    if (dropPct < 3) continue;

    const derived = deriveType(l.title);
    if (type && derived !== type) continue;

    rows.push({
      id: l.id,
      title: l.title,
      district: l.district ?? '',
      type: derived,
      priceWas: earliest.priceEur,
      priceEur: latest.priceEur,
      dropPct: Math.round(dropPct * 10) / 10,
      dropEur: earliest.priceEur - latest.priceEur,
      when: relativeWhen(latest.capturedAt, now),
    });
  }

  return c.json(rows);
});

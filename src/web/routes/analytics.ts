import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Prisma } from '@prisma/client';
import { getPrisma } from '../../db.js';
import { deriveType, roomsBucket } from '../../lib/listing-type.js';
import { fitHedonic, residualPct, type HedonicSample } from '../../lib/hedonic.js';
import { marketTemperature, type SegmentComponents } from '../../lib/market-index.js';
import {
  DISTRESS_LEXICON,
  isWeekend,
  postingHourHistogram,
  scanDistress,
  type DistressCategory,
} from '../../lib/listing-text.js';
import {
  absorptionMonths,
  iqr,
  median,
  medianDomClosed,
  newListingPremium,
  repricingVelocity,
  segmentStats,
  sellerMix,
  stddev,
  timeToFirstCutDays,
  type SegmentDim,
  type SegmentListing,
  type SegmentRow,
  type SellerMix,
} from '../../lib/market-signals.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEGMENT_DIMS: readonly SegmentDim[] = ['sector', 'rooms', 'priceBand', 'month'];

export const analyticsRouter = new Hono();

interface OverviewResponse {
  kpis: {
    medianEurPerSqm: number;
    activeInventory: number;
    uniqueInventory: number; // active listings after collapsing dedup clusters (P2)
    medianDomDays: number;
    bestDealsCount: number;
    recentDropsCount: number;
    // P0/P1 market-assessment signals.
    iqrEurPerSqm: number; // €/m² dispersion = negotiation room
    medianDomClosed: number; // realized DOM over delisted listings
    absorptionMonths: number | null; // months of supply; null when no recent delists
    repriceVelocity: number; // median mean-consecutive-delta across active listings
    timeToFirstCutDays: number | null; // median days to first observed price cut
    newListingPremium: number | null; // fresh ask €/m² ÷ standing median €/m²
    sellerMix: SellerMix; // agency / private / unknown shares
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
  url: string;
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
  watchlist: boolean;
  excluded: boolean;
}

interface PriceDropRow {
  id: string;
  url: string;
  title: string;
  district: string;
  type: string;
  priceWas: number;
  priceEur: number;
  dropPct: number;
  dropEur: number;
  when: string;
}

interface AnalyticsFilters {
  q: string | undefined;
  minPrice: number | undefined;
  maxPrice: number | undefined;
  minAreaSqm: number | undefined;
  maxAreaSqm: number | undefined;
  minLandAre: number | undefined;
  maxLandAre: number | undefined;
  minFloors: number | undefined;
  maxFloors: number | undefined;
  districts: string[];
  sectors: string[];
  type: string | undefined;
  rooms: number | undefined;
  // Inclusive rooms range — the rail's bucket ('1–2','5+') maps to these.
  // Takes precedence over the legacy single `rooms` exact-match param.
  minRooms: number | undefined;
  maxRooms: number | undefined;
  // Mirrors the Listings rail's "cheap" toggles. favorite restricts to
  // watchlisted rows; includeExcluded opts back into excluded rows (off by
  // default, matching Listings — analytics previously counted them).
  favorite: boolean;
  includeExcluded: boolean;
}

type ParsedFilters = { ok: true; filters: AnalyticsFilters } | { ok: false; error: string };

// Unified filter parsing for all three analytics routes. Mirrors Listings'
// /api/listings query params so an operator can carry a Listings filter view
// over to Analytics and see the same slice. `region` is accepted as a legacy
// alias for `district` so old saved URLs keep working without a 400.
//
// Returns a discriminated union so callers can 400 on a present-but-empty
// district parameter (`?district=`, `?district=,,,`, `?district=%20`) — that
// shape would otherwise collapse to an empty array and silently widen the
// query to "all districts", masking an operator-side bug.
function parseAnalyticsFilters(c: Context): ParsedFilters {
  const q = c.req.query('q') || undefined;
  const int = (name: string) => {
    const raw = c.req.query(name);
    if (!raw) return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isNaN(n) ? undefined : n;
  };
  const float = (name: string) => {
    const raw = c.req.query(name);
    if (!raw) return undefined;
    const n = Number.parseFloat(raw);
    return Number.isNaN(n) ? undefined : n;
  };
  const minPrice = int('minPrice');
  const maxPrice = int('maxPrice');
  const minAreaSqm = float('minAreaSqm');
  const maxAreaSqm = float('maxAreaSqm');
  const minLandAre = float('minLandAre');
  const maxLandAre = float('maxLandAre');
  const minFloors = int('minFloors');
  const maxFloors = int('maxFloors');
  // Accept both `?district=A,B` and `?district=A&district=B`. The first form
  // is what the UI emits; the second is more natural for hand-written URLs
  // and external callers. queries() returns undefined when the param is
  // absent and an array (possibly with one or more entries) when present.
  const districtParams = c.req.queries('district') ?? c.req.queries('region');
  let districts: string[] = [];
  if (districtParams !== undefined) {
    districts = districtParams
      .flatMap((raw) => raw.split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    if (districts.length === 0) {
      return {
        ok: false,
        error: 'district query parameter is empty or whitespace-only',
      };
    }
  }
  const sectorParams = c.req.queries('sector');
  let sectors: string[] = [];
  if (sectorParams !== undefined) {
    sectors = sectorParams
      .flatMap((raw) => raw.split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    if (sectors.length === 0) {
      return { ok: false, error: 'sector query parameter is empty or whitespace-only' };
    }
  }
  const type = c.req.query('type') || undefined;
  const rooms = int('rooms');
  const minRooms = int('minRooms');
  const maxRooms = int('maxRooms');
  const favorite = c.req.query('favorite') === 'true';
  const includeExcluded = c.req.query('includeExcluded') === 'true';
  return {
    ok: true,
    filters: {
      q,
      minPrice,
      maxPrice,
      minAreaSqm,
      maxAreaSqm,
      minLandAre,
      maxLandAre,
      minFloors,
      maxFloors,
      districts,
      sectors,
      type,
      rooms,
      minRooms,
      maxRooms,
      favorite,
      includeExcluded,
    },
  };
}

// Prisma where shape that applies the SQL-able subset of the filters.
// `type` is intentionally NOT here — it's a regex over title (`deriveType`),
// applied post-fetch because translating to ILIKE patterns is brittle for
// Romanian diacritics like "vilă".
function buildListingWhere(f: AnalyticsFilters): Prisma.ListingWhereInput {
  if (!Array.isArray(f.districts)) {
    throw new TypeError('AnalyticsFilters.districts must be an array');
  }
  const where: Prisma.ListingWhereInput = { active: true };
  // Default to non-excluded so analytics aggregates match the Listings view.
  // The closed-listing branches (segments/overview) merge active:false back in
  // via their own OR/override; excluded stays applied there too.
  if (!f.includeExcluded) where.excluded = false;
  if (f.favorite) where.watchlist = true;
  if (f.minPrice != null || f.maxPrice != null) {
    where.priceEur = {
      ...(f.minPrice != null ? { gte: f.minPrice } : {}),
      ...(f.maxPrice != null ? { lte: f.maxPrice } : {}),
    };
  }
  if (f.minAreaSqm != null || f.maxAreaSqm != null) {
    where.areaSqm = {
      ...(f.minAreaSqm != null ? { gte: f.minAreaSqm } : {}),
      ...(f.maxAreaSqm != null ? { lte: f.maxAreaSqm } : {}),
    };
  }
  if (f.minLandAre != null || f.maxLandAre != null) {
    where.landAre = {
      ...(f.minLandAre != null ? { gte: f.minLandAre } : {}),
      ...(f.maxLandAre != null ? { lte: f.maxLandAre } : {}),
    };
  }
  if (f.minFloors != null || f.maxFloors != null) {
    where.floors = {
      ...(f.minFloors != null ? { gte: f.minFloors } : {}),
      ...(f.maxFloors != null ? { lte: f.maxFloors } : {}),
    };
  }
  const [only] = f.districts;
  if (f.districts.length === 1 && only !== undefined) {
    where.district = only;
  } else if (f.districts.length > 1) {
    where.district = { in: f.districts };
  }
  const [onlySector] = f.sectors;
  if (f.sectors.length === 1 && onlySector !== undefined) where.sector = onlySector;
  else if (f.sectors.length > 1) where.sector = { in: f.sectors };
  // Range takes precedence over the legacy exact-match `rooms`.
  if (f.minRooms != null || f.maxRooms != null) {
    where.rooms = {
      ...(f.minRooms != null ? { gte: f.minRooms } : {}),
      ...(f.maxRooms != null ? { lte: f.maxRooms } : {}),
    };
  } else if (f.rooms != null) {
    where.rooms = f.rooms;
  }
  // Mirrors searchListings (src/mcp/queries.ts) — case-insensitive title contains.
  if (f.q) where.title = { contains: f.q, mode: 'insensitive' };
  return where;
}

function applyTypeFilter<T extends { title: string }>(rows: T[], type: string | undefined): T[] {
  if (!type) return rows;
  return rows.filter((r) => deriveType(r.title) === type);
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
  const parsed = parseAnalyticsFilters(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const filters = parsed.filters;
  const baseWhere = buildListingWhere(filters);

  const allActive = await prisma.listing.findMany({
    where: baseWhere,
    select: {
      id: true,
      title: true,
      priceEur: true,
      areaSqm: true,
      rooms: true,
      district: true,
      firstSeenAt: true,
      sellerType: true,
      canonicalId: true,
    },
  });
  const active = applyTypeFilter(allActive, filters.type);

  // Unique inventory collapses dedup clusters: one count per distinct property
  // (canonicalId, or the listing's own id when it's canonical/a singleton).
  const uniqueInventory = new Set(active.map((l) => l.canonicalId ?? l.id)).size;

  // Closed (delisted) listings within the same filter slice — the basis for
  // realized DOM, absorption, and the real gonePerWeek series. baseWhere forces
  // active:true, so override it and require a stamped delist event.
  const closedRaw = await prisma.listing.findMany({
    where: { ...baseWhere, active: false, delistedAt: { not: null } },
    select: { title: true, firstSeenAt: true, delistedAt: true },
  });
  const closed = applyTypeFilter(closedRaw, filters.type);

  const validForMedian = active.filter(
    (l): l is typeof l & { priceEur: number; areaSqm: number } =>
      l.priceEur != null && l.areaSqm != null && l.areaSqm > 0,
  );
  const eurPerSqmValues = validForMedian.map((l) => l.priceEur / l.areaSqm);
  const medianEurPerSqm = Math.round(median(eurPerSqmValues));

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
    gonePerWeek.push(
      closed.filter(
        (l) => l.delistedAt != null && l.delistedAt >= weekStart && l.delistedAt < weekEnd,
      ).length,
    );
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

  // Recent-drops counter respects the same filter slice: we look only at
  // listings already present in `active` (post-filter) and check their
  // snapshot history for a >=3% drop in the last 30 days.
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const activeIds = new Set(active.map((l) => l.id));
  const listingsWithRecentSnapshots = activeIds.size
    ? await prisma.listing.findMany({
        where: {
          id: { in: [...activeIds] },
          snapshots: { some: { capturedAt: { gte: since30d } } },
        },
        select: {
          snapshots: {
            where: { capturedAt: { gte: since30d } },
            orderBy: { capturedAt: 'asc' },
            select: { priceEur: true },
          },
        },
      })
    : [];
  let recentDropsCount = 0;
  for (const l of listingsWithRecentSnapshots) {
    if (l.snapshots.length < 2) continue;
    const earliest = l.snapshots[0];
    const latest = l.snapshots[l.snapshots.length - 1];
    if (!earliest || !latest || earliest.priceEur == null || latest.priceEur == null) continue;
    const dropPct = (1 - latest.priceEur / earliest.priceEur) * 100;
    if (dropPct >= 3) recentDropsCount++;
  }

  // District medians + best-deals count are computed within the filtered
  // slice. "Discount vs district median" is therefore relative to whatever
  // the user filtered to — intended; do not silently fall back to global.
  const districtPrices = new Map<string, number[]>();
  for (const l of validForMedian) {
    if (!l.district) continue;
    const arr = districtPrices.get(l.district) ?? [];
    arr.push(l.priceEur / l.areaSqm);
    districtPrices.set(l.district, arr);
  }
  const districtMedians = new Map<string, number>();
  for (const [d, arr] of districtPrices.entries()) {
    districtMedians.set(d, median(arr));
  }
  const bestDealsCount = validForMedian.filter((l) => {
    if (!l.district) return false;
    const m = districtMedians.get(l.district);
    if (!m || m <= 0) return false;
    return (1 - l.priceEur / l.areaSqm / m) * 100 >= 15;
  }).length;

  // ── P0/P1 market-assessment signals ──
  const iqrEurPerSqm = Math.round(iqr(eurPerSqmValues));

  // Realized DOM + absorption come from the closed slice, not active age.
  const medianDomClosedVal = medianDomClosed(closed);
  const since28d = new Date(now.getTime() - 28 * DAY_MS);
  const delistsTrailing4wk = closed.filter(
    (l) => l.delistedAt != null && l.delistedAt >= since28d,
  ).length;
  const absorptionMonthsVal = absorptionMonths(active.length, delistsTrailing4wk);

  // Fresh (<2wk) ask €/m² vs the standing-inventory median.
  const freshMs = 14 * DAY_MS;
  const freshEurPerSqm: number[] = [];
  const standingEurPerSqm: number[] = [];
  for (const l of validForMedian) {
    const value = l.priceEur / l.areaSqm;
    if (now.getTime() - l.firstSeenAt.getTime() < freshMs) freshEurPerSqm.push(value);
    else standingEurPerSqm.push(value);
  }
  const newListingPremiumVal = newListingPremium(freshEurPerSqm, standingEurPerSqm);

  const sellerMixVal = sellerMix(active.map((l) => l.sellerType));

  // Repricing velocity + time-to-first-cut need each active listing's full
  // snapshot history (ordered ascending), aggregated via the median.
  const activeWithSnapshots = activeIds.size
    ? await prisma.listing.findMany({
        where: { id: { in: [...activeIds] } },
        select: {
          firstSeenAt: true,
          snapshots: {
            orderBy: { capturedAt: 'asc' },
            select: { priceEur: true, capturedAt: true },
          },
        },
      })
    : [];
  const velocities: number[] = [];
  const firstCuts: number[] = [];
  for (const l of activeWithSnapshots) {
    const prices = l.snapshots.map((s) => s.priceEur).filter((p): p is number => p != null);
    if (prices.length >= 2) velocities.push(repricingVelocity(prices));
    const ttc = timeToFirstCutDays(l.firstSeenAt, l.snapshots);
    if (ttc != null) firstCuts.push(ttc);
  }
  const repriceVelocity = velocities.length > 0 ? Math.round(median(velocities)) : 0;
  const timeToFirstCutDaysVal = firstCuts.length > 0 ? Math.round(median(firstCuts)) : null;

  const body: OverviewResponse = {
    kpis: {
      medianEurPerSqm,
      activeInventory: active.length,
      uniqueInventory,
      medianDomDays,
      bestDealsCount,
      recentDropsCount,
      iqrEurPerSqm,
      medianDomClosed: medianDomClosedVal,
      absorptionMonths: absorptionMonthsVal,
      repriceVelocity,
      timeToFirstCutDays: timeToFirstCutDaysVal,
      newListingPremium: newListingPremiumVal,
      sellerMix: sellerMixVal,
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

// Per-segment table: €/m² median + IQR, seller mix, and realized DOM grouped by
// any subset of sector/rooms/priceBand/month. Includes active + delisted rows in
// the slice so realized DOM has data; segments below the small-sample floor are
// suppressed inside segmentStats.
analyticsRouter.get('/analytics/segments', async (c) => {
  const prisma = getPrisma();
  const parsed = parseAnalyticsFilters(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const filters = parsed.filters;

  const requested = (c.req.query('by') ?? 'sector,rooms,priceBand')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const invalid = requested.filter((d) => !SEGMENT_DIMS.includes(d as SegmentDim));
  if (requested.length === 0 || invalid.length > 0) {
    return c.json({ error: `invalid by dimensions: ${invalid.join(',') || '(empty)'}` }, 400);
  }
  const dims = requested as SegmentDim[];

  // Drop the active:true constraint baseWhere imposes — we want current
  // inventory (for €/m²) plus closed listings (for realized DOM).
  const where = buildListingWhere(filters);
  delete where.active;
  where.OR = [{ active: true }, { delistedAt: { not: null } }];

  const rowsRaw = await prisma.listing.findMany({
    where,
    select: {
      title: true,
      sector: true,
      rooms: true,
      priceEur: true,
      areaSqm: true,
      sellerType: true,
      firstSeenAt: true,
      delistedAt: true,
    },
  });
  const listings: SegmentListing[] = applyTypeFilter(rowsRaw, filters.type);
  const segments: SegmentRow[] = segmentStats(listings, dims);
  return c.json(segments);
});

// Dedup clusters: every listing whose canonicalId is set is a duplicate/relisting
// of a canonical (earliest-seen) listing. Groups them for an operator to review.
// Populated by Persistence.recomputeClusters().
analyticsRouter.get('/analytics/duplicates', async (c) => {
  const prisma = getPrisma();
  const members = await prisma.listing.findMany({
    where: { canonicalId: { not: null } },
    select: { id: true, url: true, title: true, canonicalId: true },
  });
  const byCanonical = new Map<string, { id: string; url: string; title: string }[]>();
  for (const m of members) {
    if (m.canonicalId == null) continue;
    const arr = byCanonical.get(m.canonicalId) ?? [];
    arr.push({ id: m.id, url: m.url, title: m.title });
    byCanonical.set(m.canonicalId, arr);
  }
  const canonicalIds = [...byCanonical.keys()];
  const canonRows = canonicalIds.length
    ? await prisma.listing.findMany({
        where: { id: { in: canonicalIds } },
        select: { id: true, url: true, title: true },
      })
    : [];
  const canonById = new Map(canonRows.map((r) => [r.id, r]));
  const clusters = canonicalIds
    .map((cid) => {
      const duplicates = byCanonical.get(cid) ?? [];
      const canonical = canonById.get(cid) ?? null;
      return { canonicalId: cid, canonical, duplicates, size: duplicates.length + 1 };
    })
    .sort((a, b) => b.size - a.size);
  return c.json(clusters);
});

// Seller-portfolio graph: listings + sell-through (delisted ÷ total) by authorId.
// Sparse until the next capture populates author identity — see graphql.ts.
analyticsRouter.get('/analytics/sellers', async (c) => {
  const prisma = getPrisma();
  const rows = await prisma.listing.findMany({
    where: { authorId: { not: null } },
    select: { authorId: true, authorName: true, active: true, delistedAt: true },
  });
  const byAuthor = new Map<
    string,
    { name: string | null; total: number; delisted: number; active: number }
  >();
  for (const r of rows) {
    if (r.authorId == null) continue;
    const agg = byAuthor.get(r.authorId) ?? {
      name: r.authorName,
      total: 0,
      delisted: 0,
      active: 0,
    };
    agg.total++;
    if (r.delistedAt != null) agg.delisted++;
    if (r.active) agg.active++;
    byAuthor.set(r.authorId, agg);
  }
  const sellers = [...byAuthor.entries()]
    .map(([authorId, a]) => ({
      authorId,
      authorName: a.name,
      listings: a.total,
      activeListings: a.active,
      sellThrough: a.total > 0 ? a.delisted / a.total : 0,
    }))
    .sort((x, y) => y.listings - x.listings);
  return c.json(sellers);
});

// Distress Index (P3): seller-stress gauge from description language (urgency /
// negotiable / reduced / exchange / installments), plus weekend-delist share
// (distressed sales close fast) and a posting-hour histogram. Pure-derive over
// already-stored fields — no capture dependency.
analyticsRouter.get('/analytics/distress', async (c) => {
  const prisma = getPrisma();
  const parsed = parseAnalyticsFilters(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const filters = parsed.filters;
  const baseWhere = buildListingWhere(filters);

  const active = applyTypeFilter(
    await prisma.listing.findMany({
      where: baseWhere,
      select: { title: true, description: true, postedAt: true, bumpedAt: true },
    }),
    filters.type,
  );

  const signalBreakdown = Object.fromEntries(
    (Object.keys(DISTRESS_LEXICON) as DistressCategory[]).map((k) => [k, 0]),
  ) as Record<DistressCategory, number>;
  let distressedCount = 0;
  for (const l of active) {
    const result = scanDistress(l.description);
    if (result.distressed) distressedCount++;
    for (const signal of result.signals) signalBreakdown[signal]++;
  }
  const distressShare = active.length > 0 ? distressedCount / active.length : 0;

  // Posting cadence — postedAt where known, else the bump timestamp.
  const times = active.map((l) => l.postedAt ?? l.bumpedAt).filter((d): d is Date => d != null);
  const postingHour = postingHourHistogram(times);

  // Weekend-delist share over the closed slice (distressed sales clear fast).
  const closed = applyTypeFilter(
    await prisma.listing.findMany({
      where: { ...baseWhere, active: false, delistedAt: { not: null } },
      select: { title: true, delistedAt: true },
    }),
    filters.type,
  );
  const weekendDelists = closed.filter(
    (l) => l.delistedAt != null && isWeekend(l.delistedAt),
  ).length;
  const weekendDelistShare = closed.length > 0 ? weekendDelists / closed.length : 0;

  return c.json({
    activeCount: active.length,
    distressedCount,
    distressShare,
    signalBreakdown,
    closedCount: closed.length,
    weekendDelistShare,
    postingHour,
  });
});

// Hedonic valuation / AVM (P4): fit log(price) ~ attributes over the active
// slice, then score each listing by residual (actual vs model-expected price).
// Strongly negative residual = a deal (priced below what its attributes
// warrant); positive = aspirational. Recalibrates automatically as geo/author
// features land. Cross-portal "sold-price" calibration is a later (P5) slice.
const VALUATION_MIN_SAMPLES = 10;

analyticsRouter.get('/analytics/valuation', async (c) => {
  const prisma = getPrisma();
  const parsed = parseAnalyticsFilters(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const filters = parsed.filters;
  const baseWhere = buildListingWhere(filters);

  const rows = applyTypeFilter(
    await prisma.listing.findMany({
      where: baseWhere,
      select: {
        id: true,
        url: true,
        title: true,
        priceEur: true,
        areaSqm: true,
        rooms: true,
        yearBuilt: true,
        sector: true,
        heatingType: true,
      },
    }),
    filters.type,
  );

  const toSample = (r: (typeof rows)[number]): HedonicSample => ({
    priceEur: r.priceEur,
    areaSqm: r.areaSqm,
    rooms: r.rooms,
    yearBuilt: r.yearBuilt,
    sector: r.sector,
    heatingType: r.heatingType,
    type: deriveType(r.title),
  });

  const model = fitHedonic(rows.map(toSample));
  if (!model || model.n < VALUATION_MIN_SAMPLES) {
    return c.json({
      n: model?.n ?? 0,
      minSamples: VALUATION_MIN_SAMPLES,
      insufficientData: true,
      rSquared: null,
      deals: [],
      overpriced: [],
    });
  }

  const scored = rows
    .map((r) => {
      if (r.priceEur == null || r.areaSqm == null || r.areaSqm <= 0) return null;
      const predicted = model.predict(toSample(r));
      if (predicted == null || predicted <= 0) return null;
      return {
        id: r.id,
        url: r.url,
        title: r.title,
        priceEur: r.priceEur,
        predictedEur: Math.round(predicted),
        residualPct: Math.round(residualPct(r.priceEur, predicted) * 1000) / 1000,
        sector: r.sector,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.residualPct - b.residualPct);

  const coefficients: Record<string, number> = {};
  model.featureNames.forEach((name, i) => {
    coefficients[name] = Math.round((model.coefficients[i] ?? 0) * 1e6) / 1e6;
  });

  return c.json({
    n: model.n,
    rSquared: Math.round(model.rSquared * 1000) / 1000,
    coefficients,
    deals: scored.slice(0, 20), // most underpriced first
    overpriced: scored.slice(-20).reverse(), // most overpriced first
  });
});

// Composite Market Temperature Index (P6): the capstone. Per sector, assemble
// the P0–P3 signals (realized DOM, absorption, distress share, new-listing
// premium, inventory) and z-blend them into one temperature score + a
// Buyer/Seller power label. Relative across the sectors in the filtered slice.
const MARKET_INDEX_MIN_ACTIVE = 5;

analyticsRouter.get('/analytics/market-index', async (c) => {
  const prisma = getPrisma();
  const now = new Date();
  const parsed = parseAnalyticsFilters(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const filters = parsed.filters;
  const baseWhere = buildListingWhere(filters);

  const active = applyTypeFilter(
    await prisma.listing.findMany({
      where: baseWhere,
      select: {
        title: true,
        sector: true,
        priceEur: true,
        areaSqm: true,
        firstSeenAt: true,
        description: true,
      },
    }),
    filters.type,
  );
  const closed = applyTypeFilter(
    await prisma.listing.findMany({
      where: { ...baseWhere, active: false, delistedAt: { not: null } },
      select: { title: true, sector: true, firstSeenAt: true, delistedAt: true },
    }),
    filters.type,
  );

  const activeBySector = new Map<string, typeof active>();
  for (const l of active) {
    if (!l.sector) continue;
    const bucket = activeBySector.get(l.sector);
    if (bucket) bucket.push(l);
    else activeBySector.set(l.sector, [l]);
  }
  const closedBySector = new Map<string, typeof closed>();
  for (const l of closed) {
    if (!l.sector) continue;
    const bucket = closedBySector.get(l.sector);
    if (bucket) bucket.push(l);
    else closedBySector.set(l.sector, [l]);
  }

  const since28d = new Date(now.getTime() - 28 * DAY_MS);
  const freshMs = 14 * DAY_MS;
  const components: SegmentComponents[] = [];
  for (const [sector, listings] of activeBySector) {
    if (listings.length < MARKET_INDEX_MIN_ACTIVE) continue;
    const closedHere = closedBySector.get(sector) ?? [];

    const delists4wk = closedHere.filter(
      (l) => l.delistedAt != null && l.delistedAt >= since28d,
    ).length;
    const distressed = listings.filter((l) => scanDistress(l.description).distressed).length;

    const fresh: number[] = [];
    const standing: number[] = [];
    for (const l of listings) {
      if (l.priceEur == null || l.areaSqm == null || l.areaSqm <= 0) continue;
      const eps = l.priceEur / l.areaSqm;
      if (now.getTime() - l.firstSeenAt.getTime() < freshMs) fresh.push(eps);
      else standing.push(eps);
    }

    components.push({
      key: sector,
      inventory: listings.length,
      medianDomClosed:
        closedHere.length > 0
          ? medianDomClosed(
              closedHere.map((l) => ({ firstSeenAt: l.firstSeenAt, delistedAt: l.delistedAt })),
            )
          : null,
      absorptionMonths: absorptionMonths(listings.length, delists4wk),
      distressShare: listings.length > 0 ? distressed / listings.length : 0,
      newListingPremium: newListingPremium(fresh, standing),
    });
  }

  return c.json(marketTemperature(components));
});

analyticsRouter.get('/analytics/best-buys', async (c) => {
  const prisma = getPrisma();
  const parsed = parseAnalyticsFilters(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const filters = parsed.filters;
  const baseWhere = buildListingWhere(filters);

  const listingsRaw = await prisma.listing.findMany({
    where: baseWhere,
    select: {
      id: true,
      url: true,
      title: true,
      priceEur: true,
      areaSqm: true,
      rooms: true,
      district: true,
      yearBuilt: true,
      firstSeenAt: true,
      watchlist: true,
      excluded: true,
      snapshots: { orderBy: { capturedAt: 'asc' }, select: { priceEur: true, capturedAt: true } },
    },
  });

  const listings = applyTypeFilter(listingsRaw, filters.type);

  const filtered = listings.filter(
    (l) => l.priceEur != null && l.areaSqm != null && l.areaSqm > 0 && !!l.district,
  );

  // District medians/std computed within the filtered slice — see overview's
  // matching note. Discount ratings are slice-relative by design.
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
      url: l.url,
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
      watchlist: l.watchlist,
      excluded: l.excluded,
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
  const parsed = parseAnalyticsFilters(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const filters = parsed.filters;
  const baseWhere = buildListingWhere(filters);

  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const listingsRaw = await prisma.listing.findMany({
    where: baseWhere,
    select: {
      id: true,
      url: true,
      title: true,
      district: true,
      snapshots: {
        where: { capturedAt: { gte: since } },
        orderBy: { capturedAt: 'asc' },
        select: { priceEur: true, capturedAt: true },
      },
    },
  });
  const listings = applyTypeFilter(listingsRaw, filters.type);

  const rows: PriceDropRow[] = [];
  for (const l of listings) {
    if (l.snapshots.length < 2) continue;
    const earliest = l.snapshots[0];
    const latest = l.snapshots[l.snapshots.length - 1];
    if (!earliest || !latest || earliest.priceEur == null || latest.priceEur == null) continue;

    const dropPct = (1 - latest.priceEur / earliest.priceEur) * 100;
    if (dropPct < 3) continue;

    rows.push({
      id: l.id,
      url: l.url,
      title: l.title,
      district: l.district ?? '',
      type: deriveType(l.title),
      priceWas: earliest.priceEur,
      priceEur: latest.priceEur,
      dropPct: Math.round(dropPct * 10) / 10,
      dropEur: earliest.priceEur - latest.priceEur,
      when: relativeWhen(latest.capturedAt, now),
    });
  }

  return c.json(rows);
});

// Read-only Prisma helpers backing the MCP server's three tools.
//
// Separated from the MCP transport (server.ts) so they can be unit-tested
// against a real SQLite without spawning a stdio JSON-RPC harness.
//
// Result shapes are deliberately structured JSON (not pre-formatted text) so
// Claude Desktop's analysis/visualization tool can chart them directly.

import type { PrismaClient } from '@prisma/client';

export interface FilterGroup {
  /** filterId, 0 until the taxonomy query is captured. */
  filterId: number;
  featureId: number;
  optionIds: number[];
  /** A few listing ids that have any of these option values — Claude can call get_listing on one to read labels. */
  sampleListingIds: string[];
  listingCount: number;
}

export interface SearchListingsInput {
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  minRooms?: number | undefined;
  maxRooms?: number | undefined;
  minAreaSqm?: number | undefined;
  maxAreaSqm?: number | undefined;
  district?: string | undefined;
  filters?:
    | Array<{ filterId?: number | undefined; featureId: number; optionIds: number[] }>
    | undefined;
  sort?: 'priceAsc' | 'priceDesc' | 'pricePerSqmAsc' | 'price' | 'eurm2' | 'newest' | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  q?: string | undefined;
  flags?: string | undefined;
  /** Inclusive lower bound on firstSeenAt — used to link a sweep row to the
   *  listings it added (new ones only). ISO-8601 string. */
  firstSeenAfter?: string | undefined;
  /** Inclusive lower bound on lastFetchedAt — used to link a sweep's HTTP
   *  log to all listings it fetched (new + updated). ISO-8601 string. */
  lastFetchedAfter?: string | undefined;
}

export interface SearchListingsEnvelope {
  listings: SearchListingsRow[];
  total: number;
}

export interface SearchListingsRow {
  id: string;
  url: string;
  title: string;
  priceEur: number | null;
  priceRaw: string | null;
  areaSqm: number | null;
  rooms: number | null;
  district: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface FilterValueRow {
  filterId: number;
  featureId: number;
  optionId: number | null;
  textValue: string | null;
  numericValue: number | null;
}

export interface GetListingResult {
  id: string;
  url: string;
  title: string;
  priceEur: number | null;
  priceRaw: string | null;
  rooms: number | null;
  areaSqm: number | null;
  landSqm: number | null;
  district: string | null;
  street: string | null;
  floors: number | null;
  yearBuilt: number | null;
  heatingType: string | null;
  description: string | null;
  imageUrls: string[];
  active: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  lastFetchedAt: string;
  filterValuesEnrichedAt: string | null;
  filterValues: FilterValueRow[];
}

const DEFAULT_LIMIT = 50;
const SAMPLE_LIMIT = 3;

/**
 * Aggregates the observed filter universe by walking ListingFilterValue and
 * grouping (filterId, featureId) → distinct optionIds. Useful for Claude to
 * discover what facets actually exist before constructing a search.
 */
export async function listFilters(prisma: PrismaClient): Promise<FilterGroup[]> {
  const rows = await prisma.listingFilterValue.findMany({
    where: { optionId: { not: null } },
    select: { filterId: true, featureId: true, optionId: true, listingId: true },
  });

  const map = new Map<string, FilterGroup>();
  for (const r of rows) {
    if (r.optionId == null) continue;
    const key = `${r.filterId}:${r.featureId}`;
    let group = map.get(key);
    if (!group) {
      group = {
        filterId: r.filterId,
        featureId: r.featureId,
        optionIds: [],
        sampleListingIds: [],
        listingCount: 0,
      };
      map.set(key, group);
    }
    if (!group.optionIds.includes(r.optionId)) group.optionIds.push(r.optionId);
    if (
      group.sampleListingIds.length < SAMPLE_LIMIT &&
      !group.sampleListingIds.includes(r.listingId)
    ) {
      group.sampleListingIds.push(r.listingId);
    }
    group.listingCount += 1;
  }

  return Array.from(map.values()).sort((a, b) => b.listingCount - a.listingCount);
}

/**
 * Multi-filter listing search. Top-level range filters (price/rooms/area)
 * are AND-ed; the `filters` array AND-s across (featureId, optionIds) groups
 * and OR-s within each group's option list. Returns clickable 999.md URLs
 * wrapped in an envelope with total count.
 */
export async function searchListings(
  prisma: PrismaClient,
  input: SearchListingsInput,
): Promise<SearchListingsEnvelope> {
  const where: Record<string, unknown> = { active: true };
  const filterAnds: unknown[] = [];

  if (input.minPrice !== undefined || input.maxPrice !== undefined) {
    where['priceEur'] = rangeWhere(input.minPrice, input.maxPrice);
  }
  if (input.minRooms !== undefined || input.maxRooms !== undefined) {
    where['rooms'] = rangeWhere(input.minRooms, input.maxRooms);
  }
  if (input.minAreaSqm !== undefined || input.maxAreaSqm !== undefined) {
    where['areaSqm'] = rangeWhere(input.minAreaSqm, input.maxAreaSqm);
  }
  if (input.district) where['district'] = input.district;
  if (input.q) where['title'] = { contains: input.q, mode: 'insensitive' };
  if (input.firstSeenAfter) where['firstSeenAt'] = { gte: new Date(input.firstSeenAfter) };
  if (input.lastFetchedAfter) {
    where['lastFetchedAt'] = { gte: new Date(input.lastFetchedAfter) };
  }

  for (const f of input.filters ?? []) {
    if (!f.optionIds.length) continue;
    filterAnds.push({
      filterValues: {
        some: { featureId: f.featureId, optionId: { in: f.optionIds } },
      },
    });
  }
  if (filterAnds.length > 0) where['AND'] = filterAnds;

  // Handle priceDrop flag: fetch listings with snapshots, compute drops, filter
  type ListingWithSnapshots = Awaited<
    ReturnType<typeof prisma.listing.findMany<{ include: { snapshots: true } }>>
  >[number];

  const rows: Array<
    ListingWithSnapshots | Awaited<ReturnType<typeof prisma.listing.findMany>>[number]
  > = [];

  if (input.flags === 'priceDrop') {
    // priceDrop filters AFTER fetching; pagination via offset would skip
    // rows that the post-filter would have dropped. Treat offset as best-
    // effort: applied to the pre-filter query, not the post-filter result.
    const rowsWithSnapshots = await prisma.listing.findMany({
      where,
      orderBy: orderBy(input.sort),
      take: input.limit ?? DEFAULT_LIMIT,
      skip: input.offset ?? 0,
      include: { snapshots: true },
    });

    // Filter by price drop (>= 5% drop in past 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    for (const r of rowsWithSnapshots) {
      const relevantSnapshots = r.snapshots.filter((s) => s.capturedAt >= sevenDaysAgo);
      if (relevantSnapshots.length < 2) continue; // Need both old and new

      const sorted = relevantSnapshots.sort(
        (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime(),
      );
      const oldest = sorted[0];
      const newest = sorted[relevantSnapshots.length - 1];

      if (oldest?.priceEur && newest?.priceEur) {
        const drop = ((oldest.priceEur - newest.priceEur) / oldest.priceEur) * 100;
        if (drop >= 5) rows.push(r);
      }
    }
  } else {
    const allRows = await prisma.listing.findMany({
      where,
      orderBy: orderBy(input.sort),
      take: input.limit ?? DEFAULT_LIMIT,
      skip: input.offset ?? 0,
    });
    rows.push(...allRows);
  }

  const total = await prisma.listing.count({ where });

  return {
    listings: rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title,
      priceEur: r.priceEur,
      priceRaw: r.priceRaw,
      areaSqm: r.areaSqm,
      rooms: r.rooms,
      district: r.district,
      firstSeenAt: r.firstSeenAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
    })),
    total,
  };
}

/**
 * Returns the full record for a single listing including every filter triple.
 * Used by Claude to drill into a candidate from a `search_listings` result.
 */
export async function getListing(
  prisma: PrismaClient,
  id: string,
): Promise<GetListingResult | null> {
  const row = await prisma.listing.findUnique({
    where: { id },
    include: { filterValues: true },
  });
  if (!row) return null;

  return {
    id: row.id,
    url: row.url,
    title: row.title,
    priceEur: row.priceEur,
    priceRaw: row.priceRaw,
    rooms: row.rooms,
    areaSqm: row.areaSqm,
    landSqm: row.landSqm,
    district: row.district,
    street: row.street,
    floors: row.floors,
    yearBuilt: row.yearBuilt,
    heatingType: row.heatingType,
    description: row.description,
    imageUrls: coerceStringArray(row.imageUrls),
    active: row.active,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastFetchedAt: row.lastFetchedAt.toISOString(),
    filterValuesEnrichedAt: row.filterValuesEnrichedAt?.toISOString() ?? null,
    filterValues: row.filterValues.map((f) => ({
      filterId: f.filterId,
      featureId: f.featureId,
      optionId: f.optionId,
      textValue: f.textValue,
      numericValue: f.numericValue,
    })),
  };
}

// Defense-in-depth: even though the JSONB column is shape-typed by Prisma as
// JsonValue, a hand-edited row could contain a non-array. Narrow to string[]
// so callers don't need to handle the union.
function coerceStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

function rangeWhere(min: number | undefined, max: number | undefined): Record<string, number> {
  const r: Record<string, number> = {};
  if (min !== undefined) r['gte'] = min;
  if (max !== undefined) r['lte'] = max;
  return r;
}

function orderBy(sort: SearchListingsInput['sort']): Record<string, 'asc' | 'desc'> {
  switch (sort) {
    case 'priceAsc':
    case 'price':
      return { priceEur: 'asc' };
    case 'priceDesc':
      return { priceEur: 'desc' };
    case 'pricePerSqmAsc':
    case 'eurm2':
      // No dedicated column — newest as a sensible fallback. Claude can sort
      // client-side using priceEur/areaSqm if needed.
      return { firstSeenAt: 'desc' };
    case 'newest':
    default:
      return { firstSeenAt: 'desc' };
  }
}

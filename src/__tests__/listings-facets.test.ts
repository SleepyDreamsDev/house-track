import { Hono } from 'hono';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerListingsRoutes } from '../web/routes/listings.js';

// Integration coverage for the new boolean-toggle facet counts that drive the
// unified FilterRail's "hide filters with no data" behaviour. The counts are
// computed over the same active/non-excluded universe the rail filters within
// (except excludedCount, which is the complementary excluded slice).

let prisma: PrismaClient;
let app: Hono;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  prisma = new PrismaClient({ datasources: { db: { url } } });
  app = new Hono();
  registerListingsRoutes(app, prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.listingFilterValue.deleteMany();
  await prisma.listingSnapshot.deleteMany();
  await prisma.listing.deleteMany();
});

interface SeedListing {
  id: string;
  title?: string;
  district?: string | null;
  active?: boolean;
  excluded?: boolean;
  watchlist?: boolean;
  priceEur?: number | null;
}

async function seed(s: SeedListing) {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id: s.id,
      url: `https://999.md/ro/${s.id}`,
      title: s.title ?? `Casă ${s.id}`,
      lastSeenAt: now,
      lastFetchedAt: now,
      firstSeenAt: now,
      active: s.active ?? true,
      excluded: s.excluded ?? false,
      watchlist: s.watchlist ?? false,
      district: s.district ?? 'Chișinău',
      priceEur: s.priceEur ?? 100000,
    },
  });
}

async function facets(): Promise<Record<string, unknown>> {
  const res = await app.request('/api/listings/facets');
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe('GET /api/listings/facets — toggle counts', () => {
  it('favoritesCount counts active non-excluded watchlisted listings', async () => {
    await seed({ id: 'f1', watchlist: true });
    await seed({ id: 'f2', watchlist: true });
    await seed({ id: 'f3', watchlist: true });
    await seed({ id: 'p1', watchlist: false });
    await seed({ id: 'p2', watchlist: false });
    // A watchlisted-but-excluded listing must not inflate the favorites count.
    await seed({ id: 'fx', watchlist: true, excluded: true });

    expect((await facets()).favoritesCount).toBe(3);
  });

  it('excludedCount counts active excluded listings', async () => {
    await seed({ id: 'e1', excluded: true });
    await seed({ id: 'e2', excluded: true });
    await seed({ id: 'e3', excluded: true });
    await seed({ id: 'e4', excluded: true });
    await seed({ id: 'k1' });
    await seed({ id: 'k2' });

    expect((await facets()).excludedCount).toBe(4);
  });

  it('mislabeledCount counts active non-excluded type/region mismatches', async () => {
    // typeMismatch: derivedType !== 'House'
    await seed({ id: 'm1', title: 'Duplex 120 m²', district: 'Chișinău' });
    // regionMismatch: district outside the Chișinău municipality allowlist
    await seed({ id: 'm2', title: 'Casă 100 m²', district: 'Bălți' });
    // clean
    await seed({ id: 'c1', title: 'Casă 90 m²', district: 'Chișinău' });
    await seed({ id: 'c2', title: 'Casă 80 m²', district: 'Codru' });
    // excluded mislabeled — outside the counted universe
    await seed({ id: 'mx', title: 'Vilă 200 m²', district: 'Orhei', excluded: true });

    expect((await facets()).mislabeledCount).toBe(2);
  });

  it('preserves the existing facet fields', async () => {
    await seed({ id: 'a1', priceEur: 50000 });
    const f = await facets();
    expect(f).toHaveProperty('total');
    expect(f).toHaveProperty('districts');
    expect(f).toHaveProperty('price');
    expect(f).toHaveProperty('rooms');
    expect(f).toHaveProperty('areaSqm');
    expect(f).toHaveProperty('types');
    expect(f).toHaveProperty('roomsValues');
    expect(f).toHaveProperty('landAre');
    expect(f).toHaveProperty('floors');
  });

  it('reports zero counts on an empty catalog', async () => {
    const f = await facets();
    expect(f.favoritesCount).toBe(0);
    expect(f.excludedCount).toBe(0);
    expect(f.mislabeledCount).toBe(0);
  });
});

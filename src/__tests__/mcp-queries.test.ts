import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getListing, listFilters, searchListings } from '../mcp/queries.js';

let prisma: PrismaClient;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  prisma = new PrismaClient({ datasources: { db: { url } } });
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
  priceEur?: number | null;
  rooms?: number | null;
  areaSqm?: number | null;
  district?: string | null;
  active?: boolean;
  firstSeenAt?: Date;
  filterValues?: Array<{
    filterId?: number;
    featureId: number;
    optionId?: number | null;
    textValue?: string | null;
    numericValue?: number | null;
  }>;
}

async function seed(s: SeedListing) {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id: s.id,
      url: `https://999.md/ro/${s.id}`,
      title: `Title ${s.id}`,
      lastSeenAt: now,
      lastFetchedAt: now,
      firstSeenAt: s.firstSeenAt ?? now,
      active: s.active ?? true,
      priceEur: s.priceEur ?? null,
      rooms: s.rooms ?? null,
      areaSqm: s.areaSqm ?? null,
      district: s.district ?? null,
      ...(s.filterValues
        ? {
            filterValues: {
              create: s.filterValues.map((fv) => ({
                filterId: fv.filterId ?? 0,
                featureId: fv.featureId,
                optionId: fv.optionId ?? null,
                textValue: fv.textValue ?? null,
                numericValue: fv.numericValue ?? null,
              })),
            },
          }
        : {}),
    },
  });
}

describe('listFilters', () => {
  it('Aggregates observed (filterId, featureId) → distinct optionIds with listingCount and sampleListingIds', async () => {
    await seed({
      id: 'A',
      filterValues: [
        { featureId: 1, optionId: 776 },
        { featureId: 7, optionId: 12900 },
      ],
    });
    await seed({
      id: 'B',
      filterValues: [
        { featureId: 1, optionId: 776 },
        { featureId: 7, optionId: 12901 },
      ],
    });
    await seed({
      id: 'C',
      filterValues: [{ featureId: 1, optionId: 903 }],
    });

    const groups = await listFilters(prisma);

    const f1 = groups.find((g) => g.featureId === 1);
    const f7 = groups.find((g) => g.featureId === 7);
    expect(f1).toBeDefined();
    expect(f7).toBeDefined();
    expect(f1!.optionIds.sort()).toEqual([776, 903]);
    expect(f7!.optionIds.sort()).toEqual([12900, 12901]);
    expect(f1!.listingCount).toBe(3);
    expect(f1!.sampleListingIds.length).toBeGreaterThan(0);
    expect(f1!.sampleListingIds.length).toBeLessThanOrEqual(3);
  });

  it('Skips rows with NULL optionId (text/numeric features only)', async () => {
    await seed({
      id: 'A',
      filterValues: [
        { featureId: 10, optionId: null, textValue: 'str. Test' },
        { featureId: 1, optionId: 776 },
      ],
    });

    const groups = await listFilters(prisma);

    expect(groups.find((g) => g.featureId === 10)).toBeUndefined();
    expect(groups.find((g) => g.featureId === 1)).toBeDefined();
  });

  it('Returns an empty array when no filter values exist', async () => {
    expect(await listFilters(prisma)).toEqual([]);
  });

  it('Sorts groups by listingCount descending (most-common first)', async () => {
    await seed({ id: 'A', filterValues: [{ featureId: 1, optionId: 776 }] });
    await seed({ id: 'B', filterValues: [{ featureId: 1, optionId: 776 }] });
    await seed({ id: 'C', filterValues: [{ featureId: 99, optionId: 1 }] });

    const groups = await listFilters(prisma);

    expect(groups[0]?.featureId).toBe(1);
    expect(groups[1]?.featureId).toBe(99);
  });
});

describe('searchListings', () => {
  beforeEach(async () => {
    await seed({ id: '1', priceEur: 50_000, rooms: 2, areaSqm: 80, district: 'Botanica' });
    await seed({ id: '2', priceEur: 95_000, rooms: 3, areaSqm: 120, district: 'Botanica' });
    await seed({ id: '3', priceEur: 150_000, rooms: 4, areaSqm: 180, district: 'Buiucani' });
    await seed({ id: '4', priceEur: 250_000, rooms: 5, areaSqm: 260, district: 'Centru' });
    await seed({
      id: '5',
      priceEur: 300_000,
      rooms: 6,
      areaSqm: 320,
      district: 'Telecentru',
      active: false,
    });
  });

  it('Filters by price range (min and max)', async () => {
    const { listings } = await searchListings(prisma, { minPrice: 80_000, maxPrice: 200_000 });
    expect(listings.map((x) => x.id).sort()).toEqual(['2', '3']);
  });

  it('Filters by rooms minimum', async () => {
    const { listings } = await searchListings(prisma, { minRooms: 4 });
    expect(listings.map((x) => x.id).sort()).toEqual(['3', '4']);
  });

  it('Filters by area range', async () => {
    const { listings } = await searchListings(prisma, { minAreaSqm: 100, maxAreaSqm: 200 });
    expect(listings.map((x) => x.id).sort()).toEqual(['2', '3']);
  });

  it('Filters by district', async () => {
    const { listings } = await searchListings(prisma, { district: 'Botanica' });
    expect(listings.map((x) => x.id).sort()).toEqual(['1', '2']);
  });

  it('Excludes inactive listings by default', async () => {
    const { listings } = await searchListings(prisma, {});
    expect(listings.map((x) => x.id)).not.toContain('5');
  });

  it('Returns clickable 999.md URLs and structured JSON (no formatted strings)', async () => {
    const { listings } = await searchListings(prisma, { limit: 1 });
    expect(listings[0]?.url).toMatch(/^https:\/\/999\.md\/ro\/[a-zA-Z0-9]+$/);
    expect(typeof listings[0]?.priceEur === 'number' || listings[0]?.priceEur === null).toBe(true);
  });

  it('Sort priceAsc orders by price ascending', async () => {
    const { listings } = await searchListings(prisma, { sort: 'priceAsc', limit: 3 });
    expect(listings.map((x) => x.priceEur)).toEqual([50_000, 95_000, 150_000]);
  });

  it('Sort priceDesc orders by price descending', async () => {
    const { listings } = await searchListings(prisma, { sort: 'priceDesc', limit: 2 });
    expect(listings.map((x) => x.priceEur)).toEqual([250_000, 150_000]);
  });

  it('Limit caps the result count', async () => {
    const { listings } = await searchListings(prisma, { limit: 2 });
    expect(listings).toHaveLength(2);
  });

  it('Multi-filter: AND across feature groups, OR within optionIds for one group', async () => {
    await prisma.listingFilterValue.deleteMany();
    await prisma.listing.deleteMany();
    await seed({
      id: 'X',
      filterValues: [
        { featureId: 7, optionId: 12900 },
        { featureId: 1, optionId: 776 },
      ],
    });
    await seed({
      id: 'Y',
      filterValues: [
        { featureId: 7, optionId: 12901 },
        { featureId: 1, optionId: 776 },
      ],
    });
    await seed({
      id: 'Z',
      filterValues: [{ featureId: 7, optionId: 12900 }],
    });
    await seed({
      id: 'W',
      filterValues: [{ featureId: 1, optionId: 776 }],
    });

    const { listings } = await searchListings(prisma, {
      filters: [
        { featureId: 7, optionIds: [12900, 12901] },
        { featureId: 1, optionIds: [776] },
      ],
    });

    expect(listings.map((x) => x.id).sort()).toEqual(['X', 'Y']);
  });

  it('Empty filters input is a no-op (returns all active)', async () => {
    const { listings } = await searchListings(prisma, { filters: [] });
    expect(listings.length).toBeGreaterThan(0);
  });
});

describe('getListing', () => {
  it('Returns the full record including filter values when found', async () => {
    await seed({
      id: 'FULL',
      priceEur: 100_000,
      filterValues: [
        { featureId: 1, optionId: 776 },
        { featureId: 7, optionId: 12900 },
        { featureId: 10, textValue: 'str. Test' },
        { featureId: 2, numericValue: 100_000 },
      ],
    });

    const r = await getListing(prisma, 'FULL');

    expect(r).not.toBeNull();
    expect(r!.id).toBe('FULL');
    expect(r!.url).toBe('https://999.md/ro/FULL');
    expect(r!.priceEur).toBe(100_000);
    expect(r!.filterValues).toHaveLength(4);
    expect(r!.filterValues.map((f) => f.featureId).sort((a, b) => a - b)).toEqual([1, 2, 7, 10]);
  });

  it('Returns null when the listing does not exist', async () => {
    expect(await getListing(prisma, 'NONEXISTENT')).toBeNull();
  });

  it('Returns imageUrls as a string array from the JSONB column', async () => {
    const now = new Date();
    await prisma.listing.create({
      data: {
        id: 'IMG',
        url: 'https://999.md/ro/IMG',
        title: 'X',
        lastSeenAt: now,
        lastFetchedAt: now,
        imageUrls: ['a.jpg', 'b.jpg'],
      },
    });

    const r = await getListing(prisma, 'IMG');

    expect(r?.imageUrls).toEqual(['a.jpg', 'b.jpg']);
  });

  it('Returns empty array when imageUrls column contains a non-array value', async () => {
    const now = new Date();
    await prisma.listing.create({
      data: {
        id: 'BAD_IMG',
        url: 'https://999.md/ro/BAD_IMG',
        title: 'X',
        lastSeenAt: now,
        lastFetchedAt: now,
        imageUrls: { not: 'an array' },
      },
    });

    const r = await getListing(prisma, 'BAD_IMG');

    expect(r?.imageUrls).toEqual([]);
  });
});

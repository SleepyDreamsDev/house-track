import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { searchListings } from '../mcp/queries.js';

// The unified rail surfaces Property type on Listings too. Listing has no stored
// type column — type is derived from the title via deriveType — so searchListings
// filters in memory and reports the post-filter total so pagination stays honest.

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
  await prisma.listingSnapshot.deleteMany();
  await prisma.listing.deleteMany();
});

async function seed(id: string, title: string) {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/ro/${id}`,
      title,
      lastSeenAt: now,
      lastFetchedAt: now,
      firstSeenAt: now,
      active: true,
      district: 'Chișinău',
      priceEur: 100000,
      areaSqm: 100,
    },
  });
}

describe('searchListings — derived type filter', () => {
  it('returns only listings whose derived type matches', async () => {
    await seed('h1', 'Casă 90 m²');
    await seed('h2', 'Casă 120 m²');
    await seed('v1', 'Vilă 200 m²');

    const res = await searchListings(prisma, { type: 'Villa' });
    expect(res.total).toBe(1);
    expect(res.listings.map((l) => l.id)).toEqual(['v1']);
  });

  it('reports the post-filter total so pagination is honest', async () => {
    await seed('h1', 'Casă 90 m²');
    await seed('h2', 'Casă 120 m²');
    await seed('h3', 'Casă 150 m²');
    await seed('v1', 'Vilă 200 m²');

    const res = await searchListings(prisma, { type: 'House', limit: 2 });
    expect(res.total).toBe(3);
    expect(res.listings).toHaveLength(2);
  });

  it('is a no-op when type is omitted', async () => {
    await seed('h1', 'Casă 90 m²');
    await seed('v1', 'Vilă 200 m²');

    const res = await searchListings(prisma, {});
    expect(res.total).toBe(2);
  });
});

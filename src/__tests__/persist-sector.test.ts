import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Persistence } from '../persist.js';
import type { ParsedDetail } from '../types.js';

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

function detail(overrides: Partial<ParsedDetail>): ParsedDetail {
  return {
    id: 'sec-1',
    url: 'https://999.md/ro/sec-1',
    title: 'Casă, sect. Centru',
    priceEur: 100_000,
    priceRaw: '100000 EUR',
    rooms: null,
    areaSqm: 100,
    landAre: null,
    district: 'Chișinău',
    zone: null,
    street: 'str. Test',
    floors: null,
    yearBuilt: null,
    heatingType: null,
    description: null,
    features: [],
    imageUrls: [],
    sellerType: null,
    postedAt: null,
    bumpedAt: null,
    rawHtmlHash: 'h1',
    filterValues: [],
    ...overrides,
  };
}

describe('persistDetail sets sector', () => {
  it('derives and stores the sector for a Chișinău listing', async () => {
    await new Persistence(prisma).persistDetail(detail({ id: 'sec-1' }));
    const row = await prisma.listing.findUnique({ where: { id: 'sec-1' } });
    expect(row?.sector).toBe('Centru');
  });

  it('leaves sector null for a commune listing', async () => {
    await new Persistence(prisma).persistDetail(
      detail({ id: 'sec-2', district: 'Durlești', title: 'Casă Durlești', street: 'str. Centru' }),
    );
    const row = await prisma.listing.findUnique({ where: { id: 'sec-2' } });
    expect(row?.sector).toBeNull();
  });

  it("prefers 999's structured zone over the free-text heuristic", async () => {
    // Title/description say "Centru" but 999's zone (feature 9) is Ciocana —
    // the authoritative zone must win (the bug: "3 km până la centru" houses).
    await new Persistence(prisma).persistDetail(
      detail({
        id: 'sec-3',
        zone: 'Ciocana',
        title: 'Casă, Chișinău',
        description: '3 km până la centru',
      }),
    );
    const row = await prisma.listing.findUnique({ where: { id: 'sec-3' } });
    expect(row?.sector).toBe('Ciocana');
  });
});

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { analyticsRouter } from '../web/routes/analytics.js';
import { disconnectPrisma } from '../db.js';

// The unified FilterRail surfaces Favorites-only and Show-excluded on Analytics
// too ("cheap toggles"), so the analytics endpoints must honour `favorite` and
// `includeExcluded`. By default analytics now excludes excluded listings to
// match Listings — previously they were silently counted in aggregates.

let prisma: PrismaClient;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  prisma = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  await prisma.$disconnect();
  await disconnectPrisma();
});

beforeEach(async () => {
  await prisma.listingFilterValue.deleteMany();
  await prisma.listingSnapshot.deleteMany();
  await prisma.listing.deleteMany();
});

interface SeedListing {
  id: string;
  active?: boolean;
  excluded?: boolean;
  watchlist?: boolean;
  rooms?: number;
}

async function seed(s: SeedListing) {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id: s.id,
      url: `https://999.md/ro/${s.id}`,
      title: `Casă ${s.id}`,
      lastSeenAt: now,
      lastFetchedAt: now,
      firstSeenAt: now,
      active: s.active ?? true,
      excluded: s.excluded ?? false,
      watchlist: s.watchlist ?? false,
      district: 'Chișinău',
      priceEur: 100000,
      areaSqm: 100,
      rooms: s.rooms ?? 3,
    },
  });
}

async function overview(query = ''): Promise<{ kpis: { activeInventory: number } }> {
  const res = await analyticsRouter.request(`/analytics/overview${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { kpis: { activeInventory: number } };
}

describe('analytics overview — favorite + includeExcluded toggles', () => {
  it('excludes excluded listings by default', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) await seed({ id });
    await seed({ id: 'x', excluded: true });

    const body = await overview();
    expect(body.kpis.activeInventory).toBe(5);
  });

  it('includes excluded listings when includeExcluded=true', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) await seed({ id });
    await seed({ id: 'x', excluded: true });

    const body = await overview('?includeExcluded=true');
    expect(body.kpis.activeInventory).toBe(6);
  });

  it('restricts to watchlisted listings when favorite=true', async () => {
    await seed({ id: 'w1', watchlist: true });
    await seed({ id: 'w2', watchlist: true });
    for (const id of ['n1', 'n2', 'n3', 'n4', 'n5']) await seed({ id });

    const body = await overview('?favorite=true');
    expect(body.kpis.activeInventory).toBe(2);
  });

  it('still rejects a present-but-empty district param', async () => {
    const res = await analyticsRouter.request('/analytics/overview?district=');
    expect(res.status).toBe(400);
  });
});

describe('analytics overview — rooms range', () => {
  it('honors minRooms/maxRooms as an inclusive range', async () => {
    await seed({ id: 'r1', rooms: 1 });
    await seed({ id: 'r2', rooms: 2 });
    await seed({ id: 'r3', rooms: 3 });
    await seed({ id: 'r5', rooms: 5 });

    // The '1–2' rail bucket sends minRooms=1&maxRooms=2 → only 1- and 2-room.
    const body = await overview('?minRooms=1&maxRooms=2');
    expect(body.kpis.activeInventory).toBe(2);
  });

  it('treats an open-ended minRooms (the 5+ bucket) as a lower bound', async () => {
    await seed({ id: 'r3', rooms: 3 });
    await seed({ id: 'r5', rooms: 5 });
    await seed({ id: 'r6', rooms: 6 });

    const body = await overview('?minRooms=5');
    expect(body.kpis.activeInventory).toBe(2);
  });
});

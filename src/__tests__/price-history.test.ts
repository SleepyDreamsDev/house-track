import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPriceHistory } from '../mcp/queries.js';

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

// Mirrors persist.ts: a listing always has a "current price" snapshot. Each
// snapshot row carries the price observed at capturedAt. rawHtmlHash is
// required by the schema; the dedup logic never reads it, so any unique-ish
// value is fine here.
async function seedListing(id: string) {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/ro/${id}`,
      title: `Title ${id}`,
      firstSeenAt: now,
      lastSeenAt: now,
      lastFetchedAt: now,
      active: true,
    },
  });
}

async function seedSnapshot(listingId: string, priceEur: number | null, daysAgo: number) {
  await prisma.listingSnapshot.create({
    data: {
      listingId,
      priceEur,
      capturedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      rawHtmlHash: `${listingId}-${daysAgo}-${priceEur ?? 'null'}`,
    },
  });
}

describe('getPriceHistory', () => {
  it('returns null for an unknown listing', async () => {
    expect(await getPriceHistory(prisma, 'nope')).toBeNull();
  });

  it('returns [] for a listing with no priced snapshots', async () => {
    await seedListing('h-empty');
    await seedSnapshot('h-empty', null, 1); // null-priced snapshots are skipped
    expect(await getPriceHistory(prisma, 'h-empty')).toEqual([]);
  });

  it('returns a single baseline point for one priced snapshot', async () => {
    await seedListing('h-one');
    await seedSnapshot('h-one', 50_000, 3);
    const points = await getPriceHistory(prisma, 'h-one');
    expect(points).toHaveLength(1);
    expect(points![0]).toMatchObject({
      priceEur: 50_000,
      deltaPct: null,
      direction: 'baseline',
    });
  });

  it('collapses consecutive equal prices to one point', async () => {
    await seedListing('h-flat');
    await seedSnapshot('h-flat', 50_000, 5);
    await seedSnapshot('h-flat', 50_000, 3); // unchanged price (e.g. description edit)
    await seedSnapshot('h-flat', 50_000, 1);
    const points = await getPriceHistory(prisma, 'h-flat');
    expect(points).toHaveLength(1);
    expect(points![0]!.direction).toBe('baseline');
  });

  it('keeps both increases and decreases with correct direction and deltaPct', async () => {
    await seedListing('h-moves');
    await seedSnapshot('h-moves', 50_000, 10); // baseline
    await seedSnapshot('h-moves', 51_000, 7); // +2.0% up
    await seedSnapshot('h-moves', 51_000, 5); // unchanged → collapsed
    await seedSnapshot('h-moves', 48_960, 2); // -4.0% down
    const points = await getPriceHistory(prisma, 'h-moves');
    expect(points).toHaveLength(3);
    expect(points!.map((p) => [p.priceEur, p.direction, p.deltaPct])).toEqual([
      [50_000, 'baseline', null],
      [51_000, 'up', 2.0],
      [48_960, 'down', -4.0],
    ]);
  });

  it('orders points ascending by capturedAt', async () => {
    await seedListing('h-order');
    await seedSnapshot('h-order', 70_000, 1); // most recent inserted first
    await seedSnapshot('h-order', 60_000, 9); // oldest
    const points = await getPriceHistory(prisma, 'h-order');
    expect(points!.map((p) => p.priceEur)).toEqual([60_000, 70_000]);
    expect(points!.every((p) => !Number.isNaN(Date.parse(p.capturedAt)))).toBe(true);
    expect(points![0]!.capturedAt < points![1]!.capturedAt).toBe(true);
  });
});

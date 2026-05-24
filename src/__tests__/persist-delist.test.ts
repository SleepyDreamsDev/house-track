import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Persistence } from '../persist.js';
import type { ListingStub, ParsedDetail } from '../types.js';

const DAY = 24 * 60 * 60 * 1000;

let prisma: PrismaClient;
let persist: Persistence;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  prisma = new PrismaClient({ datasources: { db: { url } } });
  persist = new Persistence(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.listingSnapshot.deleteMany();
  await prisma.listingFilterValue.deleteMany();
  await prisma.listing.deleteMany();
});

async function seed(
  id: string,
  data: Partial<{
    active: boolean;
    lastSeenAt: Date;
    delistedAt: Date | null;
    delistReason: string | null;
  }> = {},
): Promise<void> {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/ro/${id}`,
      title: `Title ${id}`,
      lastSeenAt: data.lastSeenAt ?? now,
      lastFetchedAt: now,
      active: data.active ?? true,
      delistedAt: data.delistedAt ?? null,
      delistReason: data.delistReason ?? null,
    },
  });
}

const stub = (id: string): ListingStub => ({
  id,
  url: `https://999.md/ro/${id}`,
  title: `Title ${id}`,
  priceEur: 100_000,
  priceRaw: '€100000',
  areaSqm: 120,
  postedAt: null,
});

const detail = (id: string): ParsedDetail => ({
  id,
  url: `https://999.md/ro/${id}`,
  title: `Title ${id}`,
  priceEur: 100_000,
  priceRaw: '€100000',
  rooms: 4,
  areaSqm: 120,
  landAre: 600,
  district: 'Buiucani',
  street: 'Strada Test 1',
  floors: 2,
  yearBuilt: 2010,
  heatingType: 'autonomă',
  description: 'A nice house',
  features: [],
  imageUrls: [],
  sellerType: 'private',
  postedAt: null,
  bumpedAt: null,
  rawHtmlHash: 'hash-1',
  filterValues: [],
});

describe('delist events (P0)', () => {
  it('Active listing past staleness cutoff records a delist event', async () => {
    await seed('A', { active: true, lastSeenAt: new Date(Date.now() - 3 * DAY) });

    const count = await persist.markInactiveOlderThan(2 * DAY);

    expect(count).toBe(1);
    const row = await prisma.listing.findUniqueOrThrow({ where: { id: 'A' } });
    expect(row.active).toBe(false);
    expect(row.delistedAt).not.toBeNull();
    expect(row.delistReason).toBe('stale_cutoff');
  });

  it('Re-seen listing clears delistedAt and delistReason', async () => {
    await seed('B', { active: false, delistedAt: new Date(), delistReason: 'stale_cutoff' });

    await persist.markSeen([stub('B')]);

    const row = await prisma.listing.findUniqueOrThrow({ where: { id: 'B' } });
    expect(row.active).toBe(true);
    expect(row.delistedAt).toBeNull();
    expect(row.delistReason).toBeNull();
  });

  it('Re-fetched listing (persistDetail) clears the delist event', async () => {
    await seed('C', { active: false, delistedAt: new Date(), delistReason: 'stale_cutoff' });

    await persist.persistDetail(detail('C'));

    const row = await prisma.listing.findUniqueOrThrow({ where: { id: 'C' } });
    expect(row.active).toBe(true);
    expect(row.delistedAt).toBeNull();
    expect(row.delistReason).toBeNull();
  });

  it('Legacy inactive row is backfilled from lastSeenAt', async () => {
    const seenAt = new Date('2026-05-01T00:00:00.000Z');
    await seed('D', { active: false, lastSeenAt: seenAt, delistedAt: null });

    const count = await persist.backfillDelistedEstimate();

    expect(count).toBe(1);
    const row = await prisma.listing.findUniqueOrThrow({ where: { id: 'D' } });
    expect(row.delistedAt?.toISOString()).toBe(seenAt.toISOString());
    expect(row.delistReason).toBe('backfill_estimate');
  });

  it('Backfill ignores active rows and already-stamped delist events', async () => {
    await seed('E', { active: true });
    await seed('F', { active: false, delistedAt: new Date(), delistReason: 'stale_cutoff' });

    const count = await persist.backfillDelistedEstimate();

    expect(count).toBe(0);
    const e = await prisma.listing.findUniqueOrThrow({ where: { id: 'E' } });
    const f = await prisma.listing.findUniqueOrThrow({ where: { id: 'F' } });
    expect(e.delistedAt).toBeNull();
    expect(f.delistReason).toBe('stale_cutoff');
  });
});

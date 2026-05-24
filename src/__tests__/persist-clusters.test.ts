import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Persistence } from '../persist.js';

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

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

interface SeedOpts {
  active?: boolean;
  delistedAt?: Date | null;
  firstSeenAt?: Date;
  imageUrls?: string[];
  street?: string | null;
  sector?: string | null;
  rooms?: number | null;
  areaSqm?: number | null;
}

async function seed(id: string, o: SeedOpts = {}): Promise<void> {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/ro/${id}`,
      title: `Title ${id}`,
      lastSeenAt: now,
      lastFetchedAt: now,
      active: o.active ?? true,
      delistedAt: o.delistedAt ?? null,
      firstSeenAt: o.firstSeenAt ?? now,
      imageUrls: o.imageUrls ?? [],
      street: o.street ?? null,
      sector: o.sector ?? null,
      rooms: o.rooms ?? null,
      areaSqm: o.areaSqm ?? null,
    },
  });
}

const canonicalOf = async (id: string): Promise<string | null> =>
  (await prisma.listing.findUniqueOrThrow({ where: { id }, select: { canonicalId: true } }))
    .canonicalId;

describe('recomputeClusters', () => {
  it('clusters listings sharing a CDN image; canonical = earliest, members point to it', async () => {
    await seed('A', { imageUrls: ['https://cdn/1.jpg'], firstSeenAt: ago(20) });
    await seed('B', { imageUrls: ['https://cdn/1.jpg'], firstSeenAt: ago(5) });

    const clusters = await persist.recomputeClusters();

    expect(clusters).toBe(1);
    expect(await canonicalOf('A')).toBeNull(); // canonical keeps null
    expect(await canonicalOf('B')).toBe('A'); // member points at canonical
  });

  it('links a relisting to its delisted original (cross-relist lineage)', async () => {
    await seed('OLD', {
      active: false,
      delistedAt: ago(10),
      firstSeenAt: ago(40),
      street: 'Strada Alba 7',
      sector: 'Centru',
      rooms: 3,
      areaSqm: 100,
    });
    await seed('NEW', {
      active: true,
      firstSeenAt: ago(5),
      street: 'Strada Alba 7',
      sector: 'Centru',
      rooms: 3,
      areaSqm: 103,
    });

    const clusters = await persist.recomputeClusters();

    expect(clusters).toBe(1);
    expect(await canonicalOf('OLD')).toBeNull();
    expect(await canonicalOf('NEW')).toBe('OLD');
  });

  it('leaves unrelated listings unclustered', async () => {
    await seed('X', { imageUrls: ['https://cdn/x.jpg'], street: 'A 1', sector: 'Centru' });
    await seed('Y', { imageUrls: ['https://cdn/y.jpg'], street: 'B 2', sector: 'Botanica' });

    const clusters = await persist.recomputeClusters();

    expect(clusters).toBe(0);
    expect(await canonicalOf('X')).toBeNull();
    expect(await canonicalOf('Y')).toBeNull();
  });

  it('resets a stale assignment when a listing no longer matches', async () => {
    await seed('A', { imageUrls: ['https://cdn/1.jpg'], firstSeenAt: ago(20) });
    await seed('B', { imageUrls: ['https://cdn/1.jpg'], firstSeenAt: ago(5) });
    await persist.recomputeClusters();
    expect(await canonicalOf('B')).toBe('A');

    // B re-fetched with different photos → no longer a duplicate.
    await prisma.listing.update({ where: { id: 'B' }, data: { imageUrls: ['https://cdn/2.jpg'] } });
    const clusters = await persist.recomputeClusters();

    expect(clusters).toBe(0);
    expect(await canonicalOf('B')).toBeNull();
  });
});

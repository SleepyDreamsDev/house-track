import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrisma } from '../../../db.js';
import { Persistence } from '../../../persist.js';
import { createApiApp } from '../../server.js';

let prisma: PrismaClient;
let persist: Persistence;
let app: Hono;

beforeAll(() => {
  prisma = getPrisma();
  persist = new Persistence(prisma);
  app = createApiApp();
});

beforeEach(async () => {
  await prisma.listingSnapshot.deleteMany();
  await prisma.listingFilterValue.deleteMany();
  await prisma.listing.deleteMany();
});

const now = new Date();
async function seed(
  id: string,
  o: Partial<{
    active: boolean;
    delistedAt: Date | null;
    imageUrls: string[];
    authorId: string | null;
    authorName: string | null;
  }> = {},
): Promise<void> {
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/${id}`,
      title: `Listing ${id}`,
      priceEur: 100_000,
      areaSqm: 100,
      active: o.active ?? true,
      delistedAt: o.delistedAt ?? null,
      imageUrls: o.imageUrls ?? [],
      authorId: o.authorId ?? null,
      authorName: o.authorName ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      lastFetchedAt: now,
    },
  });
}

describe('Analytics dedup — unique inventory + duplicates', () => {
  it('overview uniqueInventory collapses clusters; activeInventory does not', async () => {
    await seed('A', { imageUrls: ['https://cdn/1.jpg'] });
    await seed('B', { imageUrls: ['https://cdn/1.jpg'] }); // dup of A
    await seed('C', { imageUrls: ['https://cdn/2.jpg'] }); // unique
    await persist.recomputeClusters();

    const res = await app.request('/api/analytics/overview');
    const body = (await res.json()) as {
      kpis: { activeInventory: number; uniqueInventory: number };
    };
    expect(body.kpis.activeInventory).toBe(3);
    expect(body.kpis.uniqueInventory).toBe(2);
  });

  it('duplicates endpoint groups members under their canonical', async () => {
    await seed('A', { imageUrls: ['https://cdn/1.jpg'] });
    await seed('B', { imageUrls: ['https://cdn/1.jpg'] });
    await persist.recomputeClusters();

    const res = await app.request('/api/analytics/duplicates');
    expect(res.status).toBe(200);
    const clusters = (await res.json()) as {
      canonicalId: string;
      duplicates: { id: string }[];
      size: number;
    }[];
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.canonicalId).toBe('A');
    expect(clusters[0]!.size).toBe(2);
    expect(clusters[0]!.duplicates.map((d) => d.id)).toEqual(['B']);
  });

  it('duplicates endpoint is empty when nothing is clustered', async () => {
    await seed('A', { imageUrls: ['https://cdn/1.jpg'] });
    await seed('B', { imageUrls: ['https://cdn/2.jpg'] });
    await persist.recomputeClusters();

    const res = await app.request('/api/analytics/duplicates');
    expect((await res.json()) as unknown[]).toHaveLength(0);
  });
});

describe('Analytics dedup — sellers', () => {
  it('aggregates listings + sell-through by authorId', async () => {
    await seed('a1', { authorId: 'ag1', authorName: 'Agency One', active: true });
    await seed('a2', { authorId: 'ag1', authorName: 'Agency One', active: false, delistedAt: now });
    await seed('b1', { authorId: 'ag2', authorName: 'Agency Two', active: true });

    const res = await app.request('/api/analytics/sellers');
    expect(res.status).toBe(200);
    const sellers = (await res.json()) as {
      authorId: string;
      listings: number;
      activeListings: number;
      sellThrough: number;
    }[];

    const ag1 = sellers.find((s) => s.authorId === 'ag1');
    expect(ag1?.listings).toBe(2);
    expect(ag1?.activeListings).toBe(1);
    expect(ag1?.sellThrough).toBeCloseTo(0.5, 5);
    expect(sellers.find((s) => s.authorId === 'ag2')?.listings).toBe(1);
  });

  it('is empty while author identity is unpopulated (pre-capture)', async () => {
    await seed('x'); // authorId null
    const res = await app.request('/api/analytics/sellers');
    expect((await res.json()) as unknown[]).toHaveLength(0);
  });
});

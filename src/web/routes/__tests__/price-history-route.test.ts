import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Hono } from 'hono';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';
import type { PricePoint } from '../../../mcp/queries.js';

describe('GET /api/listings/:id/price-history', () => {
  let prisma: PrismaClient;
  let app: Hono;

  beforeAll(() => {
    prisma = getPrisma();
    app = createApiApp();
  });

  beforeEach(async () => {
    await prisma.listingSnapshot.deleteMany();
    await prisma.listingFilterValue.deleteMany();
    await prisma.listing.deleteMany();
  });

  it('returns the price-distinct timeline for a listing', async () => {
    const now = Date.now();
    await prisma.listing.create({
      data: {
        id: 'h-1',
        url: 'https://999.md/h-1',
        title: 'Test',
        active: true,
        firstSeenAt: new Date(now),
        lastSeenAt: new Date(now),
        lastFetchedAt: new Date(now),
        snapshots: {
          create: [
            { priceEur: 50_000, capturedAt: new Date(now - 5 * 86_400_000), rawHtmlHash: 'a' },
            { priceEur: 48_000, capturedAt: new Date(now - 1 * 86_400_000), rawHtmlHash: 'b' },
          ],
        },
      },
    });

    const res = await app.request('/api/listings/h-1/price-history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { points: PricePoint[] };
    expect(body.points).toHaveLength(2);
    expect(body.points[0]).toMatchObject({ priceEur: 50_000, direction: 'baseline' });
    expect(body.points[1]).toMatchObject({ priceEur: 48_000, direction: 'down', deltaPct: -4.0 });
  });

  it('returns 404 for an unknown listing', async () => {
    const res = await app.request('/api/listings/does-not-exist/price-history');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Listing not found' });
  });

  it('returns 200 with an empty array when the listing has no priced snapshots', async () => {
    const now = Date.now();
    await prisma.listing.create({
      data: {
        id: 'h-empty',
        url: 'https://999.md/h-empty',
        title: 'Empty',
        active: true,
        firstSeenAt: new Date(now),
        lastSeenAt: new Date(now),
        lastFetchedAt: new Date(now),
      },
    });
    const res = await app.request('/api/listings/h-empty/price-history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { points: PricePoint[] };
    expect(body.points).toEqual([]);
  });
});

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';
import type { Hono } from 'hono';

describe('GET /api/listings/facets sectors', () => {
  let prisma: PrismaClient;
  let app: Hono;

  beforeAll(async () => {
    prisma = getPrisma();
    app = createApiApp();
  });

  beforeEach(async () => {
    await prisma.listingSnapshot.deleteMany();
    await prisma.listingFilterValue.deleteMany();
    await prisma.listing.deleteMany();
  });

  async function seed(id: string, sector: string | null) {
    const now = new Date();
    await prisma.listing.create({
      data: {
        id,
        url: `https://999.md/${id}`,
        title: `Casă ${id}`,
        priceEur: 100_000,
        areaSqm: 100,
        district: 'Chișinău',
        sector,
        active: true,
        firstSeenAt: now,
        lastSeenAt: now,
        lastFetchedAt: now,
      },
    });
  }

  it('Sector facet lists only sectors that have listings', async () => {
    await seed('a', 'Ciocana');
    await seed('b', null);
    const res = await app.request('/api/listings/facets');
    const body = (await res.json()) as { sectors?: { name: string; count: number }[] };
    expect(body.sectors).toEqual([{ name: 'Ciocana', count: 1 }]);
  });

  it('omits the sectors key entirely when no row has a sector', async () => {
    await seed('c', null);
    const res = await app.request('/api/listings/facets');
    const body = (await res.json()) as Record<string, unknown>;
    expect('sectors' in body).toBe(false);
  });
});

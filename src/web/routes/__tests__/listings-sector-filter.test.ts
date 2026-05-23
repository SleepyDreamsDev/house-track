import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';
import type { Hono } from 'hono';

describe('GET /api/listings?sector=', () => {
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

  async function seedListing(id: string, sector: string | null) {
    const now = new Date();
    await prisma.listing.create({
      data: {
        id,
        url: `https://999.md/${id}`,
        title: `Apartament ${id}`,
        priceEur: 80_000,
        areaSqm: 60,
        district: 'Chișinău',
        sector,
        active: true,
        firstSeenAt: now,
        lastSeenAt: now,
        lastFetchedAt: now,
      },
    });
  }

  it('filters to a single sector', async () => {
    await seedListing('s-centru', 'Centru');
    await seedListing('s-botanica', 'Botanica');

    const res = await app.request('/api/listings?sector=Centru');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { listings: unknown[]; total: number };
    expect(body.total).toBe(1);
    expect(body.listings).toHaveLength(1);
    expect((body.listings[0] as { id: string }).id).toBe('s-centru');
  });

  it('filters to multiple sectors via comma-separated value', async () => {
    await seedListing('s-centru', 'Centru');
    await seedListing('s-botanica', 'Botanica');
    await seedListing('s-ciocana', 'Ciocana');

    const res = await app.request('/api/listings?sector=Centru,Botanica');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { listings: unknown[]; total: number };
    expect(body.total).toBe(2);
    expect(body.listings).toHaveLength(2);
    const ids = (body.listings as { id: string }[]).map((l) => l.id).sort();
    expect(ids).toEqual(['s-botanica', 's-centru']);
  });

  it('filters to multiple sectors via repeated query params', async () => {
    await seedListing('s-centru', 'Centru');
    await seedListing('s-botanica', 'Botanica');
    await seedListing('s-ciocana', 'Ciocana');

    const res = await app.request('/api/listings?sector=Centru&sector=Botanica');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { listings: unknown[]; total: number };
    expect(body.total).toBe(2);
    expect(body.listings).toHaveLength(2);
    const ids = (body.listings as { id: string }[]).map((l) => l.id).sort();
    expect(ids).toEqual(['s-botanica', 's-centru']);
  });

  it('returns 400 for present-but-empty sector param', async () => {
    const res = await app.request('/api/listings?sector=');
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/sector/i);
  });
});

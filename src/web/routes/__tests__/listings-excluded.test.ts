import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';
import type { Hono } from 'hono';

describe('Listing exclusion routes', () => {
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

  function makeListing(
    id: string,
    overrides: Partial<{
      excluded: boolean;
      watchlist: boolean;
      active: boolean;
    }> = {},
  ) {
    const now = new Date();
    return {
      id,
      url: `https://999.md/ro/${id}`,
      title: `Title ${id}`,
      active: overrides.active ?? true,
      excluded: overrides.excluded ?? false,
      watchlist: overrides.watchlist ?? false,
      firstSeenAt: now,
      lastSeenAt: now,
      lastFetchedAt: now,
    };
  }

  describe('GET /api/listings exclusion filter', () => {
    it('hides excluded listings by default', async () => {
      await prisma.listing.createMany({
        data: [makeListing('EXCL', { excluded: true }), makeListing('NORMAL', { excluded: false })],
      });

      const res = await app.request('/api/listings');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { listings: Array<{ id: string }>; total: number };

      const ids = body.listings.map((l) => l.id);
      expect(ids).not.toContain('EXCL');
      expect(ids).toContain('NORMAL');
    });

    it('?includeExcluded=true returns both excluded and normal listings', async () => {
      await prisma.listing.createMany({
        data: [makeListing('EXCL', { excluded: true }), makeListing('NORMAL', { excluded: false })],
      });

      const res = await app.request('/api/listings?includeExcluded=true');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { listings: Array<{ id: string }>; total: number };

      const ids = body.listings.map((l) => l.id);
      expect(ids).toContain('EXCL');
      expect(ids).toContain('NORMAL');
    });

    it('?favorite=true returns only watchlist=true listings', async () => {
      await prisma.listing.createMany({
        data: [
          makeListing('FAV', { watchlist: true }),
          makeListing('NOTFAV', { watchlist: false }),
        ],
      });

      const res = await app.request('/api/listings?favorite=true');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { listings: Array<{ id: string }>; total: number };

      const ids = body.listings.map((l) => l.id);
      expect(ids).toContain('FAV');
      expect(ids).not.toContain('NOTFAV');
    });
  });

  describe('PUT /api/listings/:id/excluded', () => {
    it('sets excluded=true and returns 200 with {id, excluded: true}', async () => {
      await prisma.listing.create({ data: makeListing('A') });

      const res = await app.request('/api/listings/A/excluded', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excluded: true }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; excluded: boolean };
      expect(body).toEqual({ id: 'A', excluded: true });

      const row = await prisma.listing.findUniqueOrThrow({ where: { id: 'A' } });
      expect(row.excluded).toBe(true);
    });

    it('returns 400 when body.excluded is not boolean', async () => {
      await prisma.listing.create({ data: makeListing('B') });

      const res = await app.request('/api/listings/B/excluded', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excluded: 'yes' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 for a missing listing id', async () => {
      const res = await app.request('/api/listings/NOPE/excluded', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excluded: true }),
      });

      expect(res.status).toBe(404);
    });

    it('un-excluding a listing restores it to the default GET view', async () => {
      await prisma.listing.create({ data: makeListing('C', { excluded: true }) });

      await app.request('/api/listings/C/excluded', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excluded: false }),
      });

      const res = await app.request('/api/listings');
      const body = (await res.json()) as { listings: Array<{ id: string }> };
      expect(body.listings.map((l) => l.id)).toContain('C');
    });
  });

  describe('GET /api/listings/facets exclusion filter', () => {
    it('omits an excluded listing district and price bound from the facets', async () => {
      await prisma.listing.createMany({
        data: [
          { ...makeListing('NORMAL'), district: 'Centru', priceEur: 100_000 },
          {
            ...makeListing('EXCL', { excluded: true }),
            district: 'SecretDistrict',
            priceEur: 999_999,
          },
        ],
      });

      const res = await app.request('/api/listings/facets');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        districts: string[];
        price: { min: number | null; max: number | null };
      };

      expect(body.districts).toContain('Centru');
      expect(body.districts).not.toContain('SecretDistrict');
      // The excluded listing's 999_999 price must not skew the rail's max bound.
      expect(body.price.max).toBe(100_000);
    });
  });
});

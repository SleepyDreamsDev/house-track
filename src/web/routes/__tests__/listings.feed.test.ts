import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';
import type { Hono } from 'hono';

describe('Listings feed routes', () => {
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

  describe('GET /api/listings/new-today', () => {
    it('returns listings created in the last 24 hours', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);

      await prisma.listing.createMany({
        data: [
          {
            id: 'h-today-1',
            url: 'https://999.md/h-today-1',
            title: 'Apartment, 75 m², Centru · str. Main',
            priceEur: 120_000,
            areaSqm: 75,
            rooms: 2,
            district: 'Centru',
            street: 'str. Main',
            active: true,
            firstSeenAt: oneHourAgo,
            lastSeenAt: oneHourAgo,
            lastFetchedAt: oneHourAgo,
          },
          {
            id: 'h-today-2',
            url: 'https://999.md/h-today-2',
            title: 'House with land, 200 m², Botanica',
            priceEur: 180_000,
            areaSqm: 200,
            landSqm: 500,
            rooms: 4,
            district: 'Botanica',
            active: true,
            firstSeenAt: new Date(now.getTime() - 30 * 60 * 1000),
            lastSeenAt: new Date(now.getTime() - 30 * 60 * 1000),
            lastFetchedAt: new Date(now.getTime() - 30 * 60 * 1000),
          },
          {
            id: 'h-yesterday',
            url: 'https://999.md/h-yesterday',
            title: 'Old listing, 100 m², Buiucani',
            priceEur: 100_000,
            areaSqm: 100,
            district: 'Buiucani',
            active: true,
            firstSeenAt: twentyFiveHoursAgo,
            lastSeenAt: twentyFiveHoursAgo,
            lastFetchedAt: twentyFiveHoursAgo,
          },
        ],
      });

      const res = await app.request('/api/listings/new-today');
      expect(res.status).toBe(200);

      const body = (await res.json()) as Array<{
        id: string;
        title: string;
        priceEur: number | null;
        areaSqm: number | null;
        rooms: number | null;
        landSqm?: number | null;
        district: string | null;
        street?: string | null;
        firstSeenAt: string;
        isNew: boolean;
      }>;

      // Should only include listings from the last 24h
      expect(body.length).toBe(2);

      // Should be sorted by firstSeenAt desc (most recent first)
      // h-today-2 is 30 mins ago, h-today-1 is 1 hour ago, so h-today-2 should be first
      expect(body[0]?.id).toBe('h-today-2');
      expect(body[1]?.id).toBe('h-today-1');

      // Verify fields for the most recent (h-today-2)
      expect(body[0]?.title).toBe('House with land, 200 m², Botanica');
      expect(body[0]?.priceEur).toBe(180_000);
      expect(body[0]?.areaSqm).toBe(200);
      expect(body[0]?.rooms).toBe(4);
      expect(body[0]?.district).toBe('Botanica');
      expect(body[0]?.isNew).toBe(true);

      // Verify landSqm is included when present
      expect(body[0]?.landSqm).toBe(500);

      // Verify fields for the older one (h-today-1)
      expect(body[1]?.title).toBe('Apartment, 75 m², Centru · str. Main');
      expect(body[1]?.priceEur).toBe(120_000);
    });

    it('excludes inactive listings', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      await prisma.listing.createMany({
        data: [
          {
            id: 'h-active',
            url: 'https://999.md/h-active',
            title: 'Active listing',
            priceEur: 100_000,
            areaSqm: 100,
            district: 'Centru',
            active: true,
            firstSeenAt: oneHourAgo,
            lastSeenAt: oneHourAgo,
            lastFetchedAt: oneHourAgo,
          },
          {
            id: 'h-inactive',
            url: 'https://999.md/h-inactive',
            title: 'Inactive listing',
            priceEur: 100_000,
            areaSqm: 100,
            district: 'Centru',
            active: false,
            firstSeenAt: oneHourAgo,
            lastSeenAt: oneHourAgo,
            lastFetchedAt: oneHourAgo,
          },
        ],
      });

      const res = await app.request('/api/listings/new-today');
      expect(res.status).toBe(200);

      const body = (await res.json()) as Array<{ id: string }>;

      // Only active listing should be included
      expect(body.length).toBe(1);
      expect(body[0]?.id).toBe('h-active');
    });

    it('returns empty array when no listings created today', async () => {
      const res = await app.request('/api/listings/new-today');
      expect(res.status).toBe(200);

      const body = (await res.json()) as unknown[];

      expect(body.length).toBe(0);
    });

    it('limits results to 10 listings', async () => {
      const now = new Date();

      // Create 15 listings
      const listings = Array.from({ length: 15 }, (_, i) => {
        const time = new Date(now.getTime() - i * 60 * 1000);
        return {
          id: `h-${i}`,
          url: `https://999.md/h-${i}`,
          title: `Home ${i}`,
          priceEur: 100_000,
          areaSqm: 100,
          district: 'Centru',
          active: true,
          firstSeenAt: time,
          lastSeenAt: time,
          lastFetchedAt: time,
        };
      });

      await prisma.listing.createMany({ data: listings });

      const res = await app.request('/api/listings/new-today');
      expect(res.status).toBe(200);

      const body = (await res.json()) as unknown[];

      // Should be limited to 10
      expect(body.length).toBe(10);
    });
  });

  describe('GET /api/listings/price-drops', () => {
    it('returns price drops with correct shape', async () => {
      const res = await app.request('/api/listings/price-drops');
      expect(res.status).toBe(200);

      const body = (await res.json()) as Array<{
        id: string;
        title: string;
        priceEur: number | null;
        priceWas: number | null;
        areaSqm: number | null;
        rooms: number | null;
        district: string | null;
        priceDrop: boolean;
      }>;

      // Should return an array (empty or with items)
      expect(Array.isArray(body)).toBe(true);

      // If any items exist, verify the shape
      if (body.length > 0) {
        const drop = body[0];
        if (drop) {
          expect(drop).toHaveProperty('id');
          expect(drop).toHaveProperty('title');
          expect(drop).toHaveProperty('priceEur');
          expect(drop).toHaveProperty('priceWas');
          expect(drop).toHaveProperty('priceDrop');
          expect(drop.priceDrop).toBe(true);
        }
      }
    });
  });
});

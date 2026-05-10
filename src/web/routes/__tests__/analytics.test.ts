import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';
import type { Hono } from 'hono';

interface OverviewResponse {
  kpis: {
    medianEurPerSqm: number;
    activeInventory: number;
    medianDomDays: number;
    bestDealsCount: number;
    recentDropsCount: number;
  };
  trendByDistrict: Record<string, number[]>;
  months: string[];
  heatmap: Record<string, Record<string, number>>;
  domBuckets: { label: string; count: number; hot?: boolean; stale?: boolean }[];
  inventory12w: number[];
  newPerWeek: number[];
  gonePerWeek: number[];
  scatter: { id: string; areaSqm: number; priceK: number; district: string }[];
}

interface BestBuyRow {
  id: string;
  title: string;
  district: string;
  type: string;
  priceEur: number;
  areaSqm: number;
  yearBuilt: number;
  daysOnMkt: number;
  eurPerSqm: number;
  medianEurPerSqm: number;
  discount: number;
  z: number;
  score: number;
  priceDrop: boolean;
  dropPct: number;
  rooms?: number;
}

interface PriceDropRow {
  id: string;
  title: string;
  district: string;
  type: string;
  priceWas: number;
  priceEur: number;
  dropPct: number;
  dropEur: number;
  when: string;
}

describe('Analytics routes', () => {
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

  describe('GET /api/analytics/overview', () => {
    it('returns OverviewResponse with all top-level keys and 5 numeric kpi subkeys', async () => {
      const now = new Date();
      await prisma.listing.createMany({
        data: [
          {
            id: 'ov-1',
            url: 'https://999.md/ov-1',
            title: 'Casă Centru',
            priceEur: 200_000,
            areaSqm: 100,
            rooms: 3,
            district: 'Centru',
            yearBuilt: 2010,
            active: true,
            firstSeenAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
            lastSeenAt: now,
            lastFetchedAt: now,
          },
          {
            id: 'ov-2',
            url: 'https://999.md/ov-2',
            title: 'Casă Botanica',
            priceEur: 150_000,
            areaSqm: 120,
            rooms: 4,
            district: 'Botanica',
            yearBuilt: 2005,
            active: true,
            firstSeenAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
            lastSeenAt: now,
            lastFetchedAt: now,
          },
        ],
      });

      const res = await app.request('/api/analytics/overview');
      expect(res.status).toBe(200);
      const body = (await res.json()) as OverviewResponse;

      expect(body).toHaveProperty('kpis');
      expect(body).toHaveProperty('trendByDistrict');
      expect(body).toHaveProperty('months');
      expect(body).toHaveProperty('heatmap');
      expect(body).toHaveProperty('domBuckets');
      expect(body).toHaveProperty('inventory12w');
      expect(body).toHaveProperty('newPerWeek');
      expect(body).toHaveProperty('gonePerWeek');
      expect(body).toHaveProperty('scatter');

      expect(typeof body.kpis.medianEurPerSqm).toBe('number');
      expect(typeof body.kpis.activeInventory).toBe('number');
      expect(typeof body.kpis.medianDomDays).toBe('number');
      expect(typeof body.kpis.bestDealsCount).toBe('number');
      expect(typeof body.kpis.recentDropsCount).toBe('number');
    });

    it('kpis.activeInventory excludes inactive listings', async () => {
      const now = new Date();
      await prisma.listing.createMany({
        data: [
          {
            id: 'a-1',
            url: 'https://999.md/a-1',
            title: 'Active 1',
            priceEur: 100_000,
            areaSqm: 100,
            rooms: 3,
            district: 'Centru',
            active: true,
            firstSeenAt: now,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
          {
            id: 'a-2',
            url: 'https://999.md/a-2',
            title: 'Active 2',
            priceEur: 110_000,
            areaSqm: 110,
            rooms: 3,
            district: 'Centru',
            active: true,
            firstSeenAt: now,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
          {
            id: 'a-3',
            url: 'https://999.md/a-3',
            title: 'Inactive',
            priceEur: 999_999,
            areaSqm: 200,
            rooms: 3,
            district: 'Centru',
            active: false,
            firstSeenAt: now,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
        ],
      });

      const res = await app.request('/api/analytics/overview');
      expect(res.status).toBe(200);
      const body = (await res.json()) as OverviewResponse;
      expect(body.kpis.activeInventory).toBe(2);
    });
  });

  describe('GET /api/analytics/best-buys', () => {
    it('returns array length ≤ 50 even when 60 listings are seeded; rows sorted by score desc', async () => {
      const now = new Date();
      const data = Array.from({ length: 60 }, (_, i) => ({
        id: `bb-${i}`,
        url: `https://999.md/bb-${i}`,
        title: `Casă ${i}`,
        priceEur: 100_000 + i * 1000,
        areaSqm: 100,
        rooms: 3,
        district: i % 2 === 0 ? 'Centru' : 'Botanica',
        yearBuilt: 2010,
        active: true,
        firstSeenAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
        lastSeenAt: now,
        lastFetchedAt: now,
      }));
      await prisma.listing.createMany({ data });

      const res = await app.request('/api/analytics/best-buys');
      expect(res.status).toBe(200);
      const body = (await res.json()) as BestBuyRow[];

      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeLessThanOrEqual(50);

      for (let i = 1; i < body.length; i++) {
        const prev = body[i - 1];
        const cur = body[i];
        if (prev && cur) {
          expect(prev.score).toBeGreaterThanOrEqual(cur.score);
        }
      }
    });

    it('filters by district=Centru and rooms=3 — every row has matching district and rooms', async () => {
      const now = new Date();
      await prisma.listing.createMany({
        data: [
          {
            id: 'f-1',
            url: 'https://999.md/f-1',
            title: 'Casă Centru 3 rooms',
            priceEur: 120_000,
            areaSqm: 90,
            rooms: 3,
            district: 'Centru',
            yearBuilt: 2010,
            active: true,
            firstSeenAt: now,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
          {
            id: 'f-2',
            url: 'https://999.md/f-2',
            title: 'Casă Centru 3 rooms B',
            priceEur: 130_000,
            areaSqm: 95,
            rooms: 3,
            district: 'Centru',
            yearBuilt: 2008,
            active: true,
            firstSeenAt: now,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
          {
            id: 'f-3',
            url: 'https://999.md/f-3',
            title: 'Casă Botanica 3 rooms',
            priceEur: 100_000,
            areaSqm: 80,
            rooms: 3,
            district: 'Botanica',
            yearBuilt: 2010,
            active: true,
            firstSeenAt: now,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
          {
            id: 'f-4',
            url: 'https://999.md/f-4',
            title: 'Casă Centru 4 rooms',
            priceEur: 200_000,
            areaSqm: 130,
            rooms: 4,
            district: 'Centru',
            yearBuilt: 2010,
            active: true,
            firstSeenAt: now,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
        ],
      });

      const res = await app.request('/api/analytics/best-buys?district=Centru&rooms=3');
      expect(res.status).toBe(200);
      const body = (await res.json()) as BestBuyRow[];

      expect(body.length).toBeGreaterThan(0);
      for (const row of body) {
        expect(row.district).toBe('Centru');
        expect(row.rooms).toBe(3);
      }
    });
  });

  describe('GET /api/analytics/price-drops', () => {
    it('period=7d excludes a 30-day-old drop and includes a 3-day-old drop', async () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const thirtyOneDaysAgo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);

      await prisma.listing.createMany({
        data: [
          {
            id: 'pd-recent',
            url: 'https://999.md/pd-recent',
            title: 'Casă recent drop',
            priceEur: 90_000,
            areaSqm: 100,
            rooms: 3,
            district: 'Centru',
            active: true,
            firstSeenAt: fourDaysAgo,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
          {
            id: 'pd-old',
            url: 'https://999.md/pd-old',
            title: 'Casă old drop',
            priceEur: 80_000,
            areaSqm: 100,
            rooms: 3,
            district: 'Centru',
            active: true,
            firstSeenAt: thirtyOneDaysAgo,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
        ],
      });

      await prisma.listingSnapshot.createMany({
        data: [
          {
            listingId: 'pd-recent',
            capturedAt: fourDaysAgo,
            priceEur: 100_000,
            rawHtmlHash: 'h1',
          },
          {
            listingId: 'pd-recent',
            capturedAt: threeDaysAgo,
            priceEur: 90_000,
            rawHtmlHash: 'h2',
          },
          {
            listingId: 'pd-old',
            capturedAt: thirtyOneDaysAgo,
            priceEur: 100_000,
            rawHtmlHash: 'h3',
          },
          {
            listingId: 'pd-old',
            capturedAt: thirtyDaysAgo,
            priceEur: 80_000,
            rawHtmlHash: 'h4',
          },
        ],
      });

      const res = await app.request('/api/analytics/price-drops?period=7d');
      expect(res.status).toBe(200);
      const body = (await res.json()) as PriceDropRow[];

      const ids = body.map((r) => r.id);
      expect(ids).toContain('pd-recent');
      expect(ids).not.toContain('pd-old');
    });

    it('defaults to 30d when period missing — a 35-day-old drop is excluded', async () => {
      const now = new Date();
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      const thirtyFiveDaysAgo = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
      const thirtySixDaysAgo = new Date(now.getTime() - 36 * 24 * 60 * 60 * 1000);

      await prisma.listing.createMany({
        data: [
          {
            id: 'pd-in',
            url: 'https://999.md/pd-in',
            title: 'Casă in window',
            priceEur: 90_000,
            areaSqm: 100,
            rooms: 3,
            district: 'Centru',
            active: true,
            firstSeenAt: sixDaysAgo,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
          {
            id: 'pd-out',
            url: 'https://999.md/pd-out',
            title: 'Casă out window',
            priceEur: 80_000,
            areaSqm: 100,
            rooms: 3,
            district: 'Centru',
            active: true,
            firstSeenAt: thirtySixDaysAgo,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
        ],
      });

      await prisma.listingSnapshot.createMany({
        data: [
          {
            listingId: 'pd-in',
            capturedAt: sixDaysAgo,
            priceEur: 100_000,
            rawHtmlHash: 'i1',
          },
          {
            listingId: 'pd-in',
            capturedAt: fiveDaysAgo,
            priceEur: 90_000,
            rawHtmlHash: 'i2',
          },
          {
            listingId: 'pd-out',
            capturedAt: thirtySixDaysAgo,
            priceEur: 100_000,
            rawHtmlHash: 'o1',
          },
          {
            listingId: 'pd-out',
            capturedAt: thirtyFiveDaysAgo,
            priceEur: 80_000,
            rawHtmlHash: 'o2',
          },
        ],
      });

      const res = await app.request('/api/analytics/price-drops');
      expect(res.status).toBe(200);
      const body = (await res.json()) as PriceDropRow[];

      const ids = body.map((r) => r.id);
      expect(ids).toContain('pd-in');
      expect(ids).not.toContain('pd-out');
    });

    it('returns 400 on invalid period', async () => {
      const res = await app.request('/api/analytics/price-drops?period=bogus');
      expect(res.status).toBe(400);
    });
  });

  describe('Listings filter parity', () => {
    const seedTwoDistricts = async () => {
      const now = new Date();
      await prisma.listing.createMany({
        data: [
          {
            id: 'fp-centru-cheap',
            url: 'https://999.md/fp-centru-cheap',
            title: 'Casă Centru cheap',
            priceEur: 100_000,
            areaSqm: 100,
            rooms: 3,
            district: 'Centru',
            active: true,
            firstSeenAt: now,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
          {
            id: 'fp-centru-expensive',
            url: 'https://999.md/fp-centru-expensive',
            title: 'Vilă Centru expensive',
            priceEur: 400_000,
            areaSqm: 200,
            rooms: 5,
            district: 'Centru',
            active: true,
            firstSeenAt: now,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
          {
            id: 'fp-botanica',
            url: 'https://999.md/fp-botanica',
            title: 'Casă Botanica',
            priceEur: 150_000,
            areaSqm: 120,
            rooms: 4,
            district: 'Botanica',
            active: true,
            firstSeenAt: now,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
        ],
      });
    };

    it('overview: q narrows activeInventory to title-matching listings', async () => {
      await seedTwoDistricts();
      const res = await app.request('/api/analytics/overview?q=Botanica');
      expect(res.status).toBe(200);
      const body = (await res.json()) as OverviewResponse;
      expect(body.kpis.activeInventory).toBe(1);
    });

    it('overview: maxPrice excludes listings priced above the cap', async () => {
      await seedTwoDistricts();
      const res = await app.request('/api/analytics/overview?maxPrice=200000');
      expect(res.status).toBe(200);
      const body = (await res.json()) as OverviewResponse;
      expect(body.kpis.activeInventory).toBe(2);
    });

    it('overview: district narrows activeInventory', async () => {
      await seedTwoDistricts();
      const res = await app.request('/api/analytics/overview?district=Botanica');
      expect(res.status).toBe(200);
      const body = (await res.json()) as OverviewResponse;
      expect(body.kpis.activeInventory).toBe(1);
    });

    it('overview: type=Villa keeps only Villa-titled rows', async () => {
      await seedTwoDistricts();
      const res = await app.request('/api/analytics/overview?type=Villa');
      expect(res.status).toBe(200);
      const body = (await res.json()) as OverviewResponse;
      expect(body.kpis.activeInventory).toBe(1);
    });

    it('overview: combined q + maxPrice + district narrows the slice', async () => {
      await seedTwoDistricts();
      const res = await app.request(
        '/api/analytics/overview?q=Cas%C4%83&maxPrice=200000&district=Centru',
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as OverviewResponse;
      expect(body.kpis.activeInventory).toBe(1);
    });

    it('best-buys: maxPrice excludes higher-priced listings', async () => {
      await seedTwoDistricts();
      const res = await app.request('/api/analytics/best-buys?maxPrice=200000');
      expect(res.status).toBe(200);
      const body = (await res.json()) as BestBuyRow[];
      const ids = body.map((r) => r.id);
      expect(ids).not.toContain('fp-centru-expensive');
      expect(ids.length).toBe(2);
    });

    it('best-buys: district= filters; legacy region= still works as alias', async () => {
      await seedTwoDistricts();
      const r1 = await app.request('/api/analytics/best-buys?district=Botanica');
      const b1 = (await r1.json()) as BestBuyRow[];
      expect(b1.every((r) => r.district === 'Botanica')).toBe(true);
      expect(b1.length).toBe(1);

      const r2 = await app.request('/api/analytics/best-buys?region=Botanica');
      const b2 = (await r2.json()) as BestBuyRow[];
      expect(b2.every((r) => r.district === 'Botanica')).toBe(true);
      expect(b2.length).toBe(1);
    });

    it('best-buys: q filters by title contains, case-insensitive', async () => {
      await seedTwoDistricts();
      const res = await app.request('/api/analytics/best-buys?q=botanica');
      expect(res.status).toBe(200);
      const body = (await res.json()) as BestBuyRow[];
      expect(body.length).toBe(1);
      expect(body[0]?.id).toBe('fp-botanica');
    });

    it('best-buys: type=Villa keeps only Villa-titled rows', async () => {
      await seedTwoDistricts();
      const res = await app.request('/api/analytics/best-buys?type=Villa');
      expect(res.status).toBe(200);
      const body = (await res.json()) as BestBuyRow[];
      expect(body.length).toBe(1);
      expect(body[0]?.id).toBe('fp-centru-expensive');
      expect(body[0]?.type).toBe('Villa');
    });

    it('price-drops: district filter is honored', async () => {
      const now = new Date();
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      await prisma.listing.createMany({
        data: [
          {
            id: 'pd-centru',
            url: 'https://999.md/pd-centru',
            title: 'Casă Centru',
            priceEur: 90_000,
            areaSqm: 100,
            rooms: 3,
            district: 'Centru',
            active: true,
            firstSeenAt: sixDaysAgo,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
          {
            id: 'pd-botanica',
            url: 'https://999.md/pd-botanica',
            title: 'Casă Botanica',
            priceEur: 90_000,
            areaSqm: 100,
            rooms: 3,
            district: 'Botanica',
            active: true,
            firstSeenAt: sixDaysAgo,
            lastSeenAt: now,
            lastFetchedAt: now,
          },
        ],
      });
      await prisma.listingSnapshot.createMany({
        data: [
          { listingId: 'pd-centru', capturedAt: sixDaysAgo, priceEur: 100_000, rawHtmlHash: 'h1' },
          { listingId: 'pd-centru', capturedAt: fiveDaysAgo, priceEur: 90_000, rawHtmlHash: 'h2' },
          {
            listingId: 'pd-botanica',
            capturedAt: sixDaysAgo,
            priceEur: 100_000,
            rawHtmlHash: 'h3',
          },
          {
            listingId: 'pd-botanica',
            capturedAt: fiveDaysAgo,
            priceEur: 90_000,
            rawHtmlHash: 'h4',
          },
        ],
      });

      const res = await app.request('/api/analytics/price-drops?district=Centru');
      expect(res.status).toBe(200);
      const body = (await res.json()) as PriceDropRow[];
      const ids = body.map((r) => r.id);
      expect(ids).toContain('pd-centru');
      expect(ids).not.toContain('pd-botanica');
    });
  });
});

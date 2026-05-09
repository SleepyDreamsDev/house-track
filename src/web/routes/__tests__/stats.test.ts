import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';
import type { Hono } from 'hono';

describe('Stats routes', () => {
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
    await prisma.sweepRun.deleteMany();
    await prisma.setting.deleteMany();
  });

  describe('GET /api/stats/by-district', () => {
    it('returns active listings grouped by district, sorted by count descending', async () => {
      // Seed listings across multiple districts
      await prisma.listing.createMany({
        data: [
          {
            id: 'h-1',
            url: 'https://999.md/h-1',
            title: 'Home 1',
            district: 'Buiucani',
            priceEur: 100_000,
            areaSqm: 100,
            active: true,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
          {
            id: 'h-2',
            url: 'https://999.md/h-2',
            title: 'Home 2',
            district: 'Buiucani',
            priceEur: 120_000,
            areaSqm: 120,
            active: true,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
          {
            id: 'h-3',
            url: 'https://999.md/h-3',
            title: 'Home 3',
            district: 'Botanica',
            priceEur: 80_000,
            areaSqm: 80,
            active: true,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
          {
            id: 'h-4',
            url: 'https://999.md/h-4',
            title: 'Home 4',
            district: 'Centru',
            priceEur: 150_000,
            areaSqm: 100,
            active: true,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
          {
            id: 'h-5',
            url: 'https://999.md/h-5',
            title: 'Home 5 (inactive)',
            district: 'Buiucani',
            priceEur: 100_000,
            areaSqm: 100,
            active: false,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
          {
            id: 'h-6',
            url: 'https://999.md/h-6',
            title: 'Home 6 (no district)',
            district: null,
            priceEur: 100_000,
            areaSqm: 100,
            active: true,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
        ],
      });

      const res = await app.request('/api/stats/by-district');
      expect(res.status).toBe(200);

      const body = (await res.json()) as Array<{
        name: string;
        count: number;
        eurPerSqm: number;
      }>;

      // Should exclude inactive listings and null districts
      expect(body.length).toBe(3);

      // Buiucani should be first (count=2, highest)
      expect(body[0]?.name).toBe('Buiucani');
      expect(body[0]?.count).toBe(2);

      // Both Botanica and Centru have count=1, so order may vary
      const otherDistricts = new Set(body.slice(1).map((b) => b.name));
      expect(otherDistricts.has('Botanica')).toBe(true);
      expect(otherDistricts.has('Centru')).toBe(true);

      // Verify eurPerSqm calculations
      // Buiucani: (100000/100 + 120000/120) / 2 = (1000 + 1000) / 2 = 1000
      expect(body[0]?.eurPerSqm).toBe(1000);

      // Botanica: 80000/80 = 1000
      const botanica = body.find((b) => b.name === 'Botanica');
      expect(botanica?.eurPerSqm).toBe(1000);

      // Centru: 150000/100 = 1500
      const centru = body.find((b) => b.name === 'Centru');
      expect(centru?.eurPerSqm).toBe(1500);
    });

    it('handles empty database gracefully', async () => {
      const res = await app.request('/api/stats/by-district');
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body.length).toBe(0);
    });

    it('counts all listings but only includes those with district', async () => {
      await prisma.listing.createMany({
        data: [
          {
            id: 'h-1',
            url: 'https://999.md/h-1',
            title: 'Home with price and area',
            district: 'Buiucani',
            priceEur: 100_000,
            areaSqm: 100,
            active: true,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
          {
            id: 'h-2',
            url: 'https://999.md/h-2',
            title: 'Home no price (counted)',
            district: 'Buiucani',
            priceEur: null,
            areaSqm: 100,
            active: true,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
          {
            id: 'h-3',
            url: 'https://999.md/h-3',
            title: 'Home no area (counted)',
            district: 'Buiucani',
            priceEur: 100_000,
            areaSqm: null,
            active: true,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
        ],
      });

      const res = await app.request('/api/stats/by-district');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ name: string; count: number }>;

      // All three have district 'Buiucani' and are active, so count should be 3
      expect(body.length).toBe(1);
      expect(body[0]?.name).toBe('Buiucani');
      expect(body[0]?.count).toBe(3);
    });
  });

  describe('GET /api/stats/new-per-day', () => {
    it('returns 7 days of daily new-listing counts, oldest first', async () => {
      const now = new Date();

      // Create listings at different times over the past 7 days
      const dates = [
        { daysAgo: 6, count: 2 },
        { daysAgo: 5, count: 3 },
        { daysAgo: 4, count: 1 },
        { daysAgo: 3, count: 4 },
        { daysAgo: 2, count: 2 },
        { daysAgo: 1, count: 5 },
        { daysAgo: 0, count: 1 },
      ];

      for (const { daysAgo, count } of dates) {
        const date = new Date(now);
        date.setUTCDate(date.getUTCDate() - daysAgo);
        date.setUTCHours(12, 0, 0, 0); // UTC noon — TZ-stable bucket

        for (let i = 0; i < count; i++) {
          await prisma.listing.create({
            data: {
              id: `h-${daysAgo}-${i}`,
              url: `https://999.md/h-${daysAgo}-${i}`,
              title: `Home ${daysAgo}-${i}`,
              priceEur: 100_000,
              areaSqm: 100,
              active: true,
              firstSeenAt: date,
              lastSeenAt: date,
              lastFetchedAt: date,
            },
          });
        }
      }

      const res = await app.request('/api/stats/new-per-day');
      expect(res.status).toBe(200);

      const body = (await res.json()) as number[];

      // Should be exactly 7 numbers
      expect(body.length).toBe(7);

      // Should match the expected counts
      expect(body).toEqual([2, 3, 1, 4, 2, 5, 1]);
    });

    it('pads missing days with zero', async () => {
      const now = new Date();

      // Only add listings 6 days ago and today
      const sixDaysAgo = new Date(now);
      sixDaysAgo.setUTCDate(sixDaysAgo.getUTCDate() - 6);
      sixDaysAgo.setUTCHours(12, 0, 0, 0);

      await prisma.listing.create({
        data: {
          id: 'h-6d',
          url: 'https://999.md/h-6d',
          title: 'Home 6d',
          priceEur: 100_000,
          areaSqm: 100,
          active: true,
          firstSeenAt: sixDaysAgo,
          lastSeenAt: sixDaysAgo,
          lastFetchedAt: sixDaysAgo,
        },
      });

      await prisma.listing.create({
        data: {
          id: 'h-0d',
          url: 'https://999.md/h-0d',
          title: 'Home 0d',
          priceEur: 100_000,
          areaSqm: 100,
          active: true,
          firstSeenAt: now,
          lastSeenAt: now,
          lastFetchedAt: now,
        },
      });

      const res = await app.request('/api/stats/new-per-day');
      expect(res.status).toBe(200);

      const body = (await res.json()) as number[];

      // Should be exactly 7 numbers with 0s for missing days
      expect(body.length).toBe(7);
      expect(body).toEqual([1, 0, 0, 0, 0, 0, 1]);
    });

    it('excludes inactive listings from counts', async () => {
      const now = new Date();

      // Add both active and inactive listings today
      await prisma.listing.create({
        data: {
          id: 'h-active',
          url: 'https://999.md/h-active',
          title: 'Home active',
          priceEur: 100_000,
          areaSqm: 100,
          active: true,
          firstSeenAt: now,
          lastSeenAt: now,
          lastFetchedAt: now,
        },
      });

      await prisma.listing.create({
        data: {
          id: 'h-inactive',
          url: 'https://999.md/h-inactive',
          title: 'Home inactive',
          priceEur: 100_000,
          areaSqm: 100,
          active: false,
          firstSeenAt: now,
          lastSeenAt: now,
          lastFetchedAt: now,
        },
      });

      const res = await app.request('/api/stats/new-per-day');
      expect(res.status).toBe(200);

      const body = (await res.json()) as number[];

      // Only active listing should be counted
      expect(body[6]).toBe(1);
    });
  });

  describe('GET /api/stats/success-rate', () => {
    it('returns rate=0 with empty database', async () => {
      const res = await app.request('/api/stats/success-rate');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        rate: number;
        ok: number;
        total: number;
        window: number;
      };
      expect(body.rate).toBe(0);
      expect(body.total).toBe(0);
      expect(body.ok).toBe(0);
      expect(body.window).toBe(100);
    });

    it('computes rate as ok-count over last N finished sweeps', async () => {
      // 2 ok + 1 failed + 1 still in_progress (excluded — no finishedAt)
      await prisma.sweepRun.createMany({
        data: [
          { status: 'ok', finishedAt: new Date() },
          { status: 'ok', finishedAt: new Date() },
          { status: 'failed', finishedAt: new Date() },
          { status: 'in_progress' },
        ],
      });

      const res = await app.request('/api/stats/success-rate');
      const body = (await res.json()) as { rate: number; ok: number; total: number };
      expect(body.total).toBe(3);
      expect(body.ok).toBe(2);
      expect(body.rate).toBeCloseTo(2 / 3, 5);
    });

    it('honors stats.successRateWindow setting', async () => {
      await prisma.setting.create({
        data: { key: 'stats.successRateWindow', valueJson: 2 },
      });
      // Create 4 finished sweeps; window=2 means only the 2 most recent matter
      const now = Date.now();
      await prisma.sweepRun.createMany({
        data: [
          { status: 'failed', finishedAt: new Date(), startedAt: new Date(now - 4000) },
          { status: 'failed', finishedAt: new Date(), startedAt: new Date(now - 3000) },
          { status: 'ok', finishedAt: new Date(), startedAt: new Date(now - 2000) },
          { status: 'ok', finishedAt: new Date(), startedAt: new Date(now - 1000) },
        ],
      });

      const res = await app.request('/api/stats/success-rate');
      const body = (await res.json()) as { rate: number; total: number; window: number };
      expect(body.window).toBe(2);
      expect(body.total).toBe(2);
      expect(body.rate).toBe(1);
    });
  });

  describe('GET /api/stats/avg-price', () => {
    it('returns avgPrice=0 with empty database', async () => {
      const res = await app.request('/api/stats/avg-price');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { avgPrice: number; count: number };
      expect(body.avgPrice).toBe(0);
      expect(body.count).toBe(0);
    });

    it('averages priceEur across active listings only', async () => {
      await prisma.listing.createMany({
        data: [
          {
            id: 'p-1',
            url: 'https://999.md/p-1',
            title: 'P1',
            priceEur: 100_000,
            areaSqm: 100,
            active: true,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
          {
            id: 'p-2',
            url: 'https://999.md/p-2',
            title: 'P2',
            priceEur: 200_000,
            areaSqm: 100,
            active: true,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
          {
            id: 'p-3',
            url: 'https://999.md/p-3',
            title: 'P3 (inactive — must be excluded)',
            priceEur: 999_999,
            areaSqm: 100,
            active: false,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
          {
            id: 'p-4',
            url: 'https://999.md/p-4',
            title: 'P4 (null price — must be excluded)',
            priceEur: null,
            areaSqm: 100,
            active: true,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            lastFetchedAt: new Date(),
          },
        ],
      });

      const res = await app.request('/api/stats/avg-price');
      const body = (await res.json()) as { avgPrice: number; count: number };
      expect(body.avgPrice).toBe(150_000);
      // P3 (inactive) and P4 (null priceEur) excluded by the WHERE clause; only P1 + P2 count
      expect(body.count).toBe(2);
    });
  });
});

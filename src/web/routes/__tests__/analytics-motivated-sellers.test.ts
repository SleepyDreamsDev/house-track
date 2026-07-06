import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

interface MotivatedSellerRow {
  id: string;
  url: string;
  title: string;
  district: string;
  sector: string | null;
  type: string;
  priceEur: number;
  areaSqm: number;
  rooms: number;
  daysOnMkt: number;
  domMedianDistrict: number;
  cuts: number;
  totalCutPct: number;
  residualPct: number | null;
  score: number;
  watchlist: boolean;
  excluded: boolean;
}

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

const now = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;
// Strong, clean log-linear signal so the model genuinely explains the variance.
const fairPrice = (area: number): number => Math.round(Math.exp(10 + 0.012 * area));

async function seedListing(
  id: string,
  areaSqm: number,
  priceEur: number,
  opts: { firstSeenAt?: Date; snapshotPrices?: number[] } = {},
): Promise<void> {
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/${id}`,
      title: 'Casă individuală',
      priceEur,
      areaSqm,
      rooms: 3,
      yearBuilt: 2010,
      district: 'Centru',
      sector: 'Centru',
      heatingType: 'autonoma',
      active: true,
      firstSeenAt: opts.firstSeenAt ?? now,
      lastSeenAt: now,
      lastFetchedAt: now,
    },
  });
  // Mirror persist.ts: every fetched listing carries at least a current-price
  // snapshot; price changes append snapshots with distinct rawHtmlHash.
  const prices = opts.snapshotPrices ?? [priceEur];
  await prisma.listingSnapshot.createMany({
    data: prices.map((p, i) => ({
      listingId: id,
      priceEur: p,
      rawHtmlHash: `${id}-h${i}`,
      capturedAt: new Date(now.getTime() - (prices.length - 1 - i) * DAY_MS),
    })),
  });
}

describe('GET /api/analytics/motivated-sellers', () => {
  it('ranks a planted overexposed, capitulating, overpriced listing first', async () => {
    const areas = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210];
    for (const area of areas) {
      await seedListing(`fair-${area}`, area, fairPrice(area));
    }
    // Planted motivated seller: on market 120 days, 2 observed cuts
    // (200% → cuts at -5% then a rebound then another cut), still ~30% above model.
    const ask = Math.round(fairPrice(125) * 1.3);
    const first = Math.round(ask / 0.9); // ~11% total cut first→current
    await seedListing('motivated', 125, ask, {
      firstSeenAt: new Date(now.getTime() - 120 * DAY_MS),
      snapshotPrices: [first, Math.round(first * 0.95), Math.round(first * 0.97), ask],
    });

    const res = await app.request('/api/analytics/motivated-sellers');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as MotivatedSellerRow[];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(50);
    const top = rows[0]!;
    expect(top.id).toBe('motivated');
    expect(top.cuts).toBe(2);
    expect(top.totalCutPct).toBeGreaterThan(9);
    expect(top.residualPct).toBeGreaterThan(0.1);
    expect(top.daysOnMkt).toBeGreaterThanOrEqual(119);
    expect(top.domMedianDistrict).toBeGreaterThanOrEqual(0);
    // Sorted by score desc.
    const scores = rows.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('returns residualPct null below the hedonic sample floor', async () => {
    await seedListing('a', 100, fairPrice(100));
    await seedListing('b', 120, fairPrice(120));

    const res = await app.request('/api/analytics/motivated-sellers');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as MotivatedSellerRow[];
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.residualPct).toBeNull();
    }
  });

  it('handles zero-snapshot listings with cuts=0 and rejects empty district param', async () => {
    await prisma.listing.create({
      data: {
        id: 'bare',
        url: 'https://999.md/bare',
        title: 'Casă individuală',
        priceEur: 100_000,
        areaSqm: 100,
        district: 'Centru',
        active: true,
        firstSeenAt: now,
        lastSeenAt: now,
        lastFetchedAt: now,
      },
    });

    const res = await app.request('/api/analytics/motivated-sellers');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as MotivatedSellerRow[];
    expect(rows[0]!.cuts).toBe(0);
    expect(rows[0]!.totalCutPct).toBe(0);

    const bad = await app.request('/api/analytics/motivated-sellers?district=');
    expect(bad.status).toBe(400);
  });

  it('excludes listings without price, area, or district from the ranking', async () => {
    await seedListing('ok', 100, 100_000);
    await prisma.listing.create({
      data: {
        id: 'no-district',
        url: 'https://999.md/no-district',
        title: 'Casă individuală',
        priceEur: 100_000,
        areaSqm: 100,
        district: null,
        active: true,
        firstSeenAt: now,
        lastSeenAt: now,
        lastFetchedAt: now,
      },
    });

    const res = await app.request('/api/analytics/motivated-sellers');
    const rows = (await res.json()) as MotivatedSellerRow[];
    expect(rows.map((r) => r.id)).toEqual(['ok']);
  });
});

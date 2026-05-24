import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

const DAY = 24 * 60 * 60 * 1000;

interface SellerMix {
  agency: number;
  private: number;
  unknown: number;
}
interface OverviewKpis {
  iqrEurPerSqm: number;
  medianDomClosed: number;
  absorptionMonths: number | null;
  repriceVelocity: number;
  timeToFirstCutDays: number | null;
  newListingPremium: number | null;
  sellerMix: SellerMix;
}
interface SegmentRow {
  key: Record<string, string>;
  count: number;
  medianEurPerSqm: number;
  iqrEurPerSqm: number;
  sellerMix: SellerMix;
  medianDomClosed: number | null;
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

/** Five active listings in one segment (Centru / 3 rooms / 100-150k band). */
async function seedOneSegment(): Promise<void> {
  await prisma.listing.createMany({
    data: [111, 100, 91, 83, 77].map((areaSqm, i) => ({
      id: `seg-${i}`,
      url: `https://999.md/seg-${i}`,
      title: `Casă Centru ${i}`,
      priceEur: 100_000,
      areaSqm,
      rooms: 3,
      sector: 'Centru',
      district: 'Centru',
      sellerType: i % 2 === 0 ? 'private' : 'agency',
      active: true,
      firstSeenAt: new Date(now.getTime() - 30 * DAY),
      lastSeenAt: now,
      lastFetchedAt: now,
    })),
  });
}

describe('Analytics market signals — overview KPIs', () => {
  it('Overview response includes the new P0/P1 KPIs', async () => {
    await seedOneSegment();
    // One closed listing: realized DOM = 20 days, delisted within the 4wk window.
    await prisma.listing.create({
      data: {
        id: 'closed-1',
        url: 'https://999.md/closed-1',
        title: 'Casă Centru închisă',
        priceEur: 110_000,
        areaSqm: 100,
        rooms: 3,
        sector: 'Centru',
        district: 'Centru',
        sellerType: 'private',
        active: false,
        firstSeenAt: new Date(now.getTime() - 20 * DAY),
        delistedAt: now,
        delistReason: 'stale_cutoff',
        lastSeenAt: now,
        lastFetchedAt: now,
      },
    });
    // Active listing with a price-drop history for repricing velocity + first-cut.
    await prisma.listingSnapshot.createMany({
      data: [
        {
          listingId: 'seg-0',
          priceEur: 100_000,
          capturedAt: new Date(now.getTime() - 30 * DAY),
          rawHtmlHash: 'h1',
        },
        {
          listingId: 'seg-0',
          priceEur: 95_000,
          capturedAt: new Date(now.getTime() - 20 * DAY),
          rawHtmlHash: 'h2',
        },
      ],
    });

    const res = await app.request('/api/analytics/overview');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kpis: OverviewKpis & Record<string, unknown>;
      gonePerWeek: number[];
    };

    expect(body.kpis).toHaveProperty('iqrEurPerSqm');
    expect(body.kpis).toHaveProperty('medianDomClosed');
    expect(body.kpis).toHaveProperty('absorptionMonths');
    expect(body.kpis).toHaveProperty('repriceVelocity');
    expect(body.kpis).toHaveProperty('timeToFirstCutDays');
    expect(body.kpis).toHaveProperty('newListingPremium');
    expect(body.kpis).toHaveProperty('sellerMix');

    expect(body.kpis.medianDomClosed).toBe(20);
    expect(body.kpis.iqrEurPerSqm).toBeGreaterThan(0);
    expect(body.kpis.absorptionMonths).toBe(5); // 5 active ÷ 1 delist in 4wk
    expect(body.kpis.sellerMix.private + body.kpis.sellerMix.agency).toBeCloseTo(1, 5);
  });

  it('gonePerWeek counts real delists and is not hardcoded to zero', async () => {
    await seedOneSegment();
    await prisma.listing.create({
      data: {
        id: 'gone-1',
        url: 'https://999.md/gone-1',
        title: 'Casă Centru gone',
        priceEur: 120_000,
        areaSqm: 100,
        sector: 'Centru',
        district: 'Centru',
        active: false,
        firstSeenAt: new Date(now.getTime() - 10 * DAY),
        delistedAt: new Date(now.getTime() - 2 * DAY), // last week bucket
        delistReason: 'stale_cutoff',
        lastSeenAt: new Date(now.getTime() - 3 * DAY),
        lastFetchedAt: now,
      },
    });

    const res = await app.request('/api/analytics/overview');
    const body = (await res.json()) as { gonePerWeek: number[] };
    expect(body.gonePerWeek.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('Analytics market signals — segments endpoint', () => {
  it('Segments endpoint returns per-segment rows', async () => {
    await seedOneSegment();

    const res = await app.request('/api/analytics/segments?by=sector,rooms,priceBand');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as SegmentRow[];

    const centru = rows.find(
      (r) => r.key.sector === 'Centru' && r.key.rooms === '3' && r.key.priceBand === '100-150k',
    );
    expect(centru).toBeDefined();
    expect(centru?.count).toBe(5);
    expect(centru?.medianEurPerSqm).toBeGreaterThan(0);
    expect(centru?.iqrEurPerSqm).toBeGreaterThan(0);
  });

  it('suppresses segments below the small-sample floor', async () => {
    await seedOneSegment(); // 5 in Centru
    // Only 3 in Botanica → below floor.
    await prisma.listing.createMany({
      data: [1, 2, 3].map((i) => ({
        id: `bot-${i}`,
        url: `https://999.md/bot-${i}`,
        title: `Casă Botanica ${i}`,
        priceEur: 100_000,
        areaSqm: 100,
        rooms: 3,
        sector: 'Botanica',
        district: 'Botanica',
        active: true,
        firstSeenAt: now,
        lastSeenAt: now,
        lastFetchedAt: now,
      })),
    });

    const res = await app.request('/api/analytics/segments?by=sector,rooms,priceBand');
    const rows = (await res.json()) as SegmentRow[];
    expect(rows.some((r) => r.key.sector === 'Botanica')).toBe(false);
    expect(rows.some((r) => r.key.sector === 'Centru')).toBe(true);
  });

  it('400s on an invalid by dimension', async () => {
    const res = await app.request('/api/analytics/segments?by=foo');
    expect(res.status).toBe(400);
  });
});

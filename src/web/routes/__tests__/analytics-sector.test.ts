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

describe('Analytics sector filter', () => {
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

  const seedTwoSectors = async () => {
    const now = new Date();
    await prisma.listing.createMany({
      data: [
        {
          id: 'sec-centru',
          url: 'https://999.md/sec-centru',
          title: 'Apartament Centru sector',
          priceEur: 120_000,
          areaSqm: 60,
          rooms: 2,
          district: 'Chișinău',
          sector: 'Centru',
          active: true,
          firstSeenAt: now,
          lastSeenAt: now,
          lastFetchedAt: now,
        },
        {
          id: 'sec-ciocana',
          url: 'https://999.md/sec-ciocana',
          title: 'Apartament Ciocana sector',
          priceEur: 90_000,
          areaSqm: 55,
          rooms: 2,
          district: 'Chișinău',
          sector: 'Ciocana',
          active: true,
          firstSeenAt: now,
          lastSeenAt: now,
          lastFetchedAt: now,
        },
      ],
    });
  };

  it('overview: ?sector=Centru narrows activeInventory to only the Centru listing', async () => {
    await seedTwoSectors();
    const res = await app.request('/api/analytics/overview?sector=Centru');
    expect(res.status).toBe(200);
    const body = (await res.json()) as OverviewResponse;
    expect(body.kpis.activeInventory).toBe(1);
  });

  it('overview: ?sector= (present but empty) returns 400', async () => {
    const res = await app.request('/api/analytics/overview?sector=');
    expect(res.status).toBe(400);
  });
});

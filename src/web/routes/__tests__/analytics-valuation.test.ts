import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

interface ValuationResponse {
  n: number;
  rSquared: number | null;
  insufficientData?: boolean;
  coefficients?: Record<string, number>;
  deals: { id: string; priceEur: number; predictedEur: number; residualPct: number }[];
  overpriced: { id: string; residualPct: number }[];
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
// Strong, clean log-linear signal so the model genuinely explains the variance.
const fairPrice = (area: number): number => Math.round(Math.exp(10 + 0.012 * area));

async function seedListing(id: string, areaSqm: number, priceEur: number): Promise<void> {
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/${id}`,
      title: 'Casă individuală',
      priceEur,
      areaSqm,
      rooms: 3,
      yearBuilt: 2010,
      sector: 'Centru',
      heatingType: 'autonoma',
      active: true,
      firstSeenAt: now,
      lastSeenAt: now,
      lastFetchedAt: now,
    },
  });
}

describe('GET /api/analytics/valuation', () => {
  it('fits the hedonic model and flags a planted underpriced listing as the top deal', async () => {
    const areas = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210];
    for (const area of areas) {
      await seedListing(`fair-${area}`, area, fairPrice(area));
    }
    // Planted deal: priced at 65% of the fair model price for its size.
    await seedListing('deal', 125, Math.round(fairPrice(125) * 0.65));

    const res = await app.request('/api/analytics/valuation');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ValuationResponse;

    expect(body.insufficientData).toBeUndefined();
    expect(body.n).toBe(areas.length + 1);
    expect(body.rSquared!).toBeGreaterThan(0.8);
    expect(body.deals[0]!.id).toBe('deal');
    expect(body.deals[0]!.residualPct).toBeLessThan(-0.2);
  });

  it('reports insufficientData below the minimum sample size', async () => {
    await seedListing('a', 100, fairPrice(100));
    await seedListing('b', 120, fairPrice(120));

    const res = await app.request('/api/analytics/valuation');
    const body = (await res.json()) as ValuationResponse;
    expect(body.insufficientData).toBe(true);
    expect(body.deals).toHaveLength(0);
    expect(body.rSquared).toBeNull();
  });
});

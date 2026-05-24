import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

const DAY = 24 * 60 * 60 * 1000;

interface MarketIndexResponse {
  segments: { key: string; temperatureScore: number; power: string; inventory: number }[];
  summary: { buyers: number; balanced: number; sellers: number };
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
let seq = 0;
async function seed(
  sector: string,
  o: {
    active?: boolean;
    delistedAt?: Date | null;
    firstSeenAt?: Date;
    description?: string | null;
  } = {},
): Promise<void> {
  const id = `m${seq++}`;
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/${id}`,
      title: 'Casă',
      priceEur: 100_000,
      areaSqm: 100,
      sector,
      district: sector,
      active: o.active ?? true,
      delistedAt: o.delistedAt ?? null,
      description: o.description ?? null,
      firstSeenAt: o.firstSeenAt ?? new Date(now.getTime() - 3 * DAY),
      lastSeenAt: now,
      lastFetchedAt: now,
    },
  });
}

describe('GET /api/analytics/market-index', () => {
  it('ranks a hot sector above a cold one and labels power', async () => {
    // HOT (Centru): neutral text, fast closings (low DOM), brisk turnover.
    for (let i = 0; i < 6; i++) await seed('Centru', { description: 'Apartament luminos' });
    for (let i = 0; i < 4; i++) {
      await seed('Centru', {
        active: false,
        firstSeenAt: new Date(now.getTime() - 20 * DAY),
        delistedAt: new Date(now.getTime() - 5 * DAY), // DOM ~15d, recent
      });
    }
    // COLD (Botanica): distress language, one slow sale (high DOM, low turnover).
    for (let i = 0; i < 6; i++) await seed('Botanica', { description: 'Urgent, se vinde, torg' });
    await seed('Botanica', {
      active: false,
      firstSeenAt: new Date(now.getTime() - 160 * DAY),
      delistedAt: new Date(now.getTime() - 5 * DAY), // DOM ~155d
    });

    const res = await app.request('/api/analytics/market-index');
    expect(res.status).toBe(200);
    const body = (await res.json()) as MarketIndexResponse;

    expect(body.segments).toHaveLength(2);
    expect(body.segments[0]!.key).toBe('Centru');
    expect(body.segments[body.segments.length - 1]!.key).toBe('Botanica');
    expect(body.segments[0]!.temperatureScore).toBeGreaterThan(body.segments[1]!.temperatureScore);
    const power = Object.fromEntries(body.segments.map((s) => [s.key, s.power]));
    expect(power.Centru).toBe('sellers');
    expect(power.Botanica).toBe('buyers');
    expect(body.summary.sellers).toBe(1);
    expect(body.summary.buyers).toBe(1);
  });

  it('suppresses sectors below the minimum active count', async () => {
    for (let i = 0; i < 6; i++) await seed('Centru', { description: 'neutral' });
    for (let i = 0; i < 6; i++) await seed('Botanica', { description: 'neutral' });
    for (let i = 0; i < 3; i++) await seed('Telecentru', { description: 'neutral' }); // < 5

    const res = await app.request('/api/analytics/market-index');
    const body = (await res.json()) as MarketIndexResponse;
    expect(body.segments.map((s) => s.key).sort()).toEqual(['Botanica', 'Centru']);
  });
});

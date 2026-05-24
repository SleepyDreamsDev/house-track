import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

interface DistressResponse {
  activeCount: number;
  distressedCount: number;
  distressShare: number;
  signalBreakdown: Record<string, number>;
  closedCount: number;
  weekendDelistShare: number;
  postingHour: number[];
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
async function seed(
  id: string,
  o: Partial<{
    active: boolean;
    delistedAt: Date | null;
    description: string | null;
    postedAt: Date | null;
  }> = {},
): Promise<void> {
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/${id}`,
      title: `Listing ${id}`,
      priceEur: 100_000,
      areaSqm: 100,
      active: o.active ?? true,
      delistedAt: o.delistedAt ?? null,
      description: o.description ?? null,
      postedAt: o.postedAt ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      lastFetchedAt: now,
    },
  });
}

describe('GET /api/analytics/distress', () => {
  it('reports distress share and signal breakdown from descriptions', async () => {
    await seed('d1', { description: 'Se vinde URGENT, preț redus' }); // urgency + reduced
    await seed('d2', { description: 'Accept schimb sau torg' }); // exchange + negotiable
    await seed('n1', { description: 'Apartament spațios, vedere frumoasă' }); // none
    await seed('n2', { description: null });

    const res = await app.request('/api/analytics/distress');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DistressResponse;

    expect(body.activeCount).toBe(4);
    expect(body.distressedCount).toBe(2);
    expect(body.distressShare).toBeCloseTo(0.5, 5);
    expect(body.signalBreakdown.urgency).toBe(1);
    expect(body.signalBreakdown.reduced).toBe(1);
    expect(body.signalBreakdown.exchange).toBe(1);
    expect(body.signalBreakdown.negotiable).toBe(1);
  });

  it('computes weekend-delist share over the closed slice', async () => {
    await seed('active', { description: 'neutral' });
    await seed('sat', { active: false, delistedAt: new Date('2026-05-23T10:00:00Z') }); // Saturday
    await seed('mon', { active: false, delistedAt: new Date('2026-05-25T10:00:00Z') }); // Monday

    const res = await app.request('/api/analytics/distress');
    const body = (await res.json()) as DistressResponse;

    expect(body.closedCount).toBe(2);
    expect(body.weekendDelistShare).toBeCloseTo(0.5, 5);
  });

  it('builds a posting-hour histogram from postedAt', async () => {
    await seed('p1', { postedAt: new Date('2026-05-10T09:00:00Z') });
    await seed('p2', { postedAt: new Date('2026-05-11T09:30:00Z') });

    const res = await app.request('/api/analytics/distress');
    const body = (await res.json()) as DistressResponse;

    expect(body.postingHour).toHaveLength(24);
    expect(body.postingHour[9]).toBe(2);
  });

  it('returns zeros for an empty database', async () => {
    const res = await app.request('/api/analytics/distress');
    const body = (await res.json()) as DistressResponse;
    expect(body.activeCount).toBe(0);
    expect(body.distressShare).toBe(0);
    expect(body.weekendDelistShare).toBe(0);
  });
});

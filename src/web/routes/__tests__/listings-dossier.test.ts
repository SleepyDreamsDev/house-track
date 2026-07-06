import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

interface DossierResponse {
  activeDOM: number;
  domMedianDistrict: number | null;
  hedonic: { predictedEur: number; residualPct: number } | null;
  postedAt: string | null;
  bumpedAt: string | null;
  authorName: string | null;
  authorListings: {
    id: string;
    url: string;
    title: string;
    priceEur: number | null;
    active: boolean;
    delistedAt: string | null;
  }[];
  cluster: {
    canonicalId: string;
    members: {
      id: string;
      url: string;
      title: string;
      priceEur: number | null;
      active: boolean;
      delistedAt: string | null;
      firstSeenAt: string;
    }[];
  } | null;
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
const fairPrice = (area: number): number => Math.round(Math.exp(10 + 0.012 * area));

async function seedListing(
  id: string,
  areaSqm: number,
  priceEur: number,
  extra: Record<string, unknown> = {},
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
      firstSeenAt: now,
      lastSeenAt: now,
      lastFetchedAt: now,
      ...extra,
    },
  });
  // Mirror persist.ts: every fetched listing carries a current-price snapshot.
  await prisma.listingSnapshot.create({
    data: { listingId: id, priceEur, rawHtmlHash: `${id}-h0`, capturedAt: now },
  });
}

describe('GET /api/listings/:id/dossier', () => {
  it('returns DOM, hedonic residual, author portfolio, and cluster with delisted sibling', async () => {
    const areas = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190];
    for (const area of areas) {
      await seedListing(`fair-${area}`, area, fairPrice(area));
    }
    // Target: 60 days on market, priced 30% over model, with an author id.
    await seedListing('target', 125, Math.round(fairPrice(125) * 1.3), {
      firstSeenAt: new Date(now.getTime() - 60 * DAY_MS),
      authorId: 'author-1',
      authorName: 'Agenția X',
      postedAt: new Date(now.getTime() - 61 * DAY_MS),
    });
    // Same author, different listing.
    await seedListing('sibling-author', 100, fairPrice(100), { authorId: 'author-1' });
    // Delisted dedup sibling pointing at target as canonical.
    await seedListing('relist-old', 124, Math.round(fairPrice(125) * 1.4), {
      active: false,
      delistedAt: new Date(now.getTime() - 30 * DAY_MS),
      canonicalId: 'target',
    });

    const res = await app.request('/api/listings/target/dossier');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DossierResponse;

    expect(body.activeDOM).toBeGreaterThanOrEqual(59);
    expect(body.domMedianDistrict).not.toBeNull();
    expect(body.hedonic).not.toBeNull();
    expect(body.hedonic!.residualPct).toBeGreaterThan(0.1);
    expect(body.hedonic!.predictedEur).toBeGreaterThan(0);
    expect(body.authorName).toBe('Agenția X');
    expect(body.postedAt).not.toBeNull();
    expect(body.authorListings.map((l) => l.id)).toEqual(['sibling-author']);
    expect(body.cluster).not.toBeNull();
    expect(body.cluster!.canonicalId).toBe('target');
    expect(body.cluster!.members.map((m) => m.id)).toEqual(['relist-old']);
    expect(body.cluster!.members[0]!.active).toBe(false);
    expect(body.cluster!.members[0]!.delistedAt).not.toBeNull();
  });

  it('resolves the cluster from a non-canonical member too', async () => {
    await seedListing('canon', 100, 100_000);
    await seedListing('dupe', 101, 99_000, { canonicalId: 'canon' });

    const res = await app.request('/api/listings/dupe/dossier');
    const body = (await res.json()) as DossierResponse;
    expect(body.cluster!.canonicalId).toBe('canon');
    expect(body.cluster!.members.map((m) => m.id)).toEqual(['canon']);
  });

  it('returns nulls and empty lists when data is sparse', async () => {
    // Below hedonic floor, no author, no cluster, no district.
    await seedListing('lonely', 100, 100_000, { district: null });

    const res = await app.request('/api/listings/lonely/dossier');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DossierResponse;
    expect(body.hedonic).toBeNull();
    expect(body.domMedianDistrict).toBeNull();
    expect(body.authorListings).toEqual([]);
    expect(body.cluster).toBeNull();
  });

  it('computes the district DOM median over the priced subset, matching motivated-sellers', async () => {
    await seedListing('d10', 100, 100_000, {
      firstSeenAt: new Date(now.getTime() - 10 * DAY_MS),
    });
    await seedListing('d20', 110, 110_000, {
      firstSeenAt: new Date(now.getTime() - 20 * DAY_MS),
    });
    // Unpriced row with a huge DOM — must NOT drag the median up.
    await prisma.listing.create({
      data: {
        id: 'unpriced-ancient',
        url: 'https://999.md/unpriced-ancient',
        title: 'Casă individuală',
        priceEur: null,
        areaSqm: null,
        district: 'Centru',
        active: true,
        firstSeenAt: new Date(now.getTime() - 1000 * DAY_MS),
        lastSeenAt: now,
        lastFetchedAt: now,
      },
    });

    const res = await app.request('/api/listings/d10/dossier');
    const body = (await res.json()) as DossierResponse;
    expect(body.domMedianDistrict).toBe(15);
  });

  it('returns 404 for an unknown listing', async () => {
    const res = await app.request('/api/listings/nope/dossier');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Listing not found');
  });
});

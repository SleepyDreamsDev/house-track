import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Persistence } from '../persist.js';
import type { ListingStub } from '../types.js';

let prisma: PrismaClient;
let persist: Persistence;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  prisma = new PrismaClient({ datasources: { db: { url } } });
  persist = new Persistence(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.listingSnapshot.deleteMany();
  await prisma.listingFilterValue.deleteMany();
  await prisma.listing.deleteMany();
});

const stub = (id: string, overrides: Partial<ListingStub> = {}): ListingStub => ({
  id,
  url: `https://999.md/ro/${id}`,
  title: `Title ${id}`,
  priceEur: 100_000,
  priceRaw: '€100000',
  areaSqm: 120,
  postedAt: null,
  imageUrls: [],
  ...overrides,
});

async function seedListing(
  id: string,
  fields: Partial<{
    excluded: boolean;
    watchlist: boolean;
    active: boolean;
    lastFetchedAt: Date;
    filterValuesEnrichedAt: Date | null;
  }> = {},
): Promise<void> {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/ro/${id}`,
      title: `Title ${id}`,
      lastSeenAt: now,
      lastFetchedAt: fields.lastFetchedAt ?? now,
      active: fields.active ?? true,
      excluded: fields.excluded ?? false,
      watchlist: fields.watchlist ?? false,
      ...('filterValuesEnrichedAt' in fields
        ? { filterValuesEnrichedAt: fields.filterValuesEnrichedAt }
        : {}),
    },
  });
}

describe('Persistence — excluded flag', () => {
  describe('diffAgainstDb', () => {
    it('Excluded known listing is NOT in seen', async () => {
      await seedListing('X', { excluded: true });

      const result = await persist.diffAgainstDb([stub('X')]);

      expect(result.seen.map((s) => s.id)).not.toContain('X');
      expect(result.new.map((s) => s.id)).not.toContain('X');
    });

    it('Non-excluded known listing IS in seen', async () => {
      await seedListing('Y', { excluded: false });

      const result = await persist.diffAgainstDb([stub('Y')]);

      expect(result.seen.map((s) => s.id)).toContain('Y');
    });

    it('Brand-new stub (not in DB) is in new', async () => {
      const result = await persist.diffAgainstDb([stub('BRAND_NEW')]);

      expect(result.new.map((s) => s.id)).toContain('BRAND_NEW');
    });
  });

  describe('findStaleListings', () => {
    it('Excludes an active excluded listing whose lastFetchedAt is old', async () => {
      const old = new Date(Date.now() - 10 * 60 * 60 * 1000);
      await seedListing('EXCL', { excluded: true, active: true, lastFetchedAt: old });

      const ids = await persist.findStaleListings({ limit: 10, sinceFetched: new Date() });

      expect(ids).not.toContain('EXCL');
    });

    it('Includes a non-excluded active listing whose lastFetchedAt is old', async () => {
      const old = new Date(Date.now() - 10 * 60 * 60 * 1000);
      await seedListing('NOTEXCL', { excluded: false, active: true, lastFetchedAt: old });

      const ids = await persist.findStaleListings({ limit: 10, sinceFetched: new Date() });

      expect(ids).toContain('NOTEXCL');
    });
  });

  describe('findUnenrichedListings', () => {
    it('Excludes an active excluded listing with null filterValuesEnrichedAt', async () => {
      await seedListing('EXCL_UE', {
        excluded: true,
        active: true,
        filterValuesEnrichedAt: null,
      });

      const ids = await persist.findUnenrichedListings(10);

      expect(ids).not.toContain('EXCL_UE');
    });

    it('Includes a non-excluded active listing with null filterValuesEnrichedAt', async () => {
      await seedListing('NOTEXCL_UE', {
        excluded: false,
        active: true,
        filterValuesEnrichedAt: null,
      });

      const ids = await persist.findUnenrichedListings(10);

      expect(ids).toContain('NOTEXCL_UE');
    });
  });

  describe('setExcluded', () => {
    it('Sets excluded=true on a listing', async () => {
      await seedListing('TOGGLE', { excluded: false });

      await persist.setExcluded('TOGGLE', true);

      const row = await prisma.listing.findUniqueOrThrow({ where: { id: 'TOGGLE' } });
      expect(row.excluded).toBe(true);
    });

    it('Sets excluded=false on a listing', async () => {
      await seedListing('TOGGLE', { excluded: true });

      await persist.setExcluded('TOGGLE', false);

      const row = await prisma.listing.findUniqueOrThrow({ where: { id: 'TOGGLE' } });
      expect(row.excluded).toBe(false);
    });
  });
});

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FILTER } from '../config.js';
import { resolveActiveFilter } from '../filter-resolver.js';
import { setSetting } from '../settings.js';
import { defaultGenericFilter } from '../types/filter.js';

let prisma: PrismaClient;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  prisma = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.setting.deleteMany();
});

describe('resolveActiveFilter', () => {
  it('falls back to the config constant when no setting exists', async () => {
    const resolved = await resolveActiveFilter();
    expect(resolved.sourceSlug).toBe('999md');
    expect(resolved.searchInput.subCategoryId).toBe(FILTER.searchInput.subCategoryId);
    expect(resolved.postFilter.maxPriceEur).toBe(FILTER.postFilter.maxPriceEur);
  });

  it('reads the persisted generic filter and runs the active source resolve()', async () => {
    await setSetting('filter.generic', { ...defaultGenericFilter, priceMax: 180_000 });
    const resolved = await resolveActiveFilter();
    expect(resolved.postFilter.maxPriceEur).toBe(180_000);
    expect(resolved.searchInput.subCategoryId).toBe(1406);
    expect(resolved.generic.priceMax).toBe(180_000);
  });

  it('falls back when the persisted setting fails schema validation', async () => {
    // Bypass setSetting (which validates) — write garbage directly.
    await prisma.setting.create({
      data: { key: 'filter.generic', valueJson: { not: 'a filter' } },
    });
    const resolved = await resolveActiveFilter();
    expect(resolved.postFilter.maxPriceEur).toBe(FILTER.postFilter.maxPriceEur);
    expect(resolved.generic).toEqual(defaultGenericFilter);
  });
});

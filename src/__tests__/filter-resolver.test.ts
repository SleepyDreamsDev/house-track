import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resolveActiveFilter } from '../filter-resolver.js';
import { setSetting } from '../settings.js';
import { defaultGenericFilter } from '../types/filter.js';
import type { GenericFilter } from '../types/filter.js';

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
    expect(resolved.searchInput.subCategoryId).toBe(1406);
    expect(resolved).not.toHaveProperty('postFilter');
    const priceGroup = resolved.searchInput.filters.find((f) => f.filterId === 9441);
    expect(priceGroup).toBeDefined();
  });

  it('reads the persisted generic filter and runs the active source resolve()', async () => {
    const customFilter: GenericFilter = {
      category: 'house',
      filters: [
        { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
        { kind: 'options', filterId: 32, featureId: 7, optionIds: [12900] },
        { kind: 'range', filterId: 9441, featureId: 2, unit: 'UNIT_EUR', max: '180000' },
      ],
    };
    await setSetting('filter.generic', customFilter);
    const resolved = await resolveActiveFilter();
    expect(resolved).not.toHaveProperty('postFilter');
    const priceGroup = resolved.searchInput.filters.find((f) => f.filterId === 9441);
    expect(priceGroup?.features[0]).toMatchObject({
      featureId: 2,
      unit: 'UNIT_EUR',
      range: { max: '180000' },
    });
    expect(resolved.searchInput.subCategoryId).toBe(1406);
    expect(resolved.generic.category).toBe('house');
  });

  it('falls back when the persisted setting fails schema validation', async () => {
    // Bypass setSetting (which validates) — write garbage directly.
    await prisma.setting.create({
      data: { key: 'filter.generic', valueJson: { not: 'a filter' } },
    });
    const resolved = await resolveActiveFilter();
    expect(resolved).not.toHaveProperty('postFilter');
    const priceGroup = resolved.searchInput.filters.find((f) => f.filterId === 9441);
    expect(priceGroup).toBeDefined();
    expect(resolved.generic).toEqual(defaultGenericFilter);
  });
});

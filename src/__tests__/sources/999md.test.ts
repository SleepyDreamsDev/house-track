import { describe, expect, it } from 'vitest';

import { source999md } from '../../sources/999md.js';
import { getSource, listSources } from '../../sources/index.js';
import { UnknownGenericFilterValueError } from '../../sources/types.js';
import { defaultGenericFilter } from '../../types/filter.js';
import type { GenericFilter } from '../../types/filter.js';

const base: GenericFilter = {
  category: 'house',
  filters: [
    { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
    { kind: 'options', filterId: 32, featureId: 7, optionIds: [12900] },
  ],
};

describe('999md source adapter', () => {
  it('resolves the default generic filter without error', () => {
    expect(() => source999md.resolve(defaultGenericFilter)).not.toThrow();
  });

  it('resolves to subCategoryId 1406 for house category', () => {
    const resolved = source999md.resolve(defaultGenericFilter);
    expect(resolved.searchInput.subCategoryId).toBe(1406);
  });

  it('source is AD_SOURCE_DESKTOP_REDESIGN', () => {
    const resolved = source999md.resolve(defaultGenericFilter);
    expect(resolved.searchInput.source).toBe('AD_SOURCE_DESKTOP_REDESIGN');
  });

  it('999md adapter throws UnknownGenericFilterValueError on an unknown filterId', () => {
    expect(() =>
      source999md.resolve({
        ...base,
        filters: [
          ...base.filters,
          { kind: 'options', filterId: 99999, featureId: 1, optionIds: [776] },
        ],
      }),
    ).toThrow(UnknownGenericFilterValueError);
  });

  it('999md adapter routes price max to postFilter', () => {
    const resolved = source999md.resolve({
      ...base,
      filters: [
        ...base.filters,
        { kind: 'range', filterId: 9441, featureId: 2, unit: 'UNIT_EUR', max: '180000' },
      ],
    });
    expect(resolved.postFilter.maxPriceEur).toBe(180_000);
  });

  it('no price selection gives sentinel postFilter', () => {
    const resolved = source999md.resolve(base);
    expect(resolved.postFilter).toEqual({
      minPriceEur: 0,
      maxPriceEur: Number.MAX_SAFE_INTEGER,
    });
  });

  it('merges range selection into the resolved searchInput.filters', () => {
    const resolved = source999md.resolve({
      ...base,
      filters: [
        ...base.filters,
        { kind: 'range', filterId: 1201, featureId: 588, min: '2', max: '4' },
      ],
    });
    const g = resolved.searchInput.filters.find((f) => f.filterId === 1201);
    expect(g?.features[0]).toMatchObject({ featureId: 588, range: { min: '2', max: '4' } });
  });

  it('merges multiple optionIds for the same featureId', () => {
    const resolved = source999md.resolve({
      category: 'house',
      filters: [
        { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
        { kind: 'options', filterId: 32, featureId: 7, optionIds: [12900, 12885] },
      ],
    });
    const regionGroup = resolved.searchInput.filters.find((f) => f.filterId === 32);
    const feat = regionGroup?.features[0] as { featureId: number; optionIds: number[] } | undefined;
    expect(feat?.optionIds).toContain(12900);
    expect(feat?.optionIds).toContain(12885);
  });
});

describe('source registry', () => {
  it('listSources returns at least the 999md adapter', () => {
    const sources = listSources();
    expect(sources.some((s) => s.slug === '999md' && typeof s.resolve === 'function')).toBe(true);
  });

  it('getSource returns null for an unknown slug', () => {
    expect(getSource('lara')).toBeNull();
  });
});

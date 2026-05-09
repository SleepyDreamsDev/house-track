import { describe, expect, it } from 'vitest';

import { FILTER } from '../../config.js';
import { source999md } from '../../sources/999md.js';
import { getSource, listSources } from '../../sources/index.js';
import { UnknownGenericFilterValueError } from '../../sources/types.js';
import { defaultGenericFilter } from '../../types/filter.js';

describe('999md source adapter', () => {
  it("resolves the default generic filter to today's exact searchInput", () => {
    const resolved = source999md.resolve(defaultGenericFilter);
    expect(resolved.searchInput.subCategoryId).toBe(FILTER.searchInput.subCategoryId);
    expect(resolved.searchInput.source).toBe(FILTER.searchInput.source);

    const expectedFilters = JSON.parse(JSON.stringify(FILTER.searchInput.filters));
    const actualFilters = JSON.parse(JSON.stringify(resolved.searchInput.filters));
    expect(actualFilters).toEqual(expectedFilters);
  });

  it("resolves the default generic filter to today's exact postFilter", () => {
    const resolved = source999md.resolve(defaultGenericFilter);
    expect(resolved.postFilter.maxPriceEur).toBe(FILTER.postFilter.maxPriceEur);
    expect(resolved.postFilter.maxAreaSqm).toBe(FILTER.postFilter.maxAreaSqm);
  });

  it('999md adapter throws UnknownGenericFilterValueError on an unmapped locality', () => {
    expect(() =>
      source999md.resolve({
        ...defaultGenericFilter,
        // Cast required because the public type bars values not in LOCALITIES;
        // the test simulates a defense-in-depth case where the schema is
        // bypassed (e.g., direct setSetting from an admin script).
        locality: ['atlantis' as never],
      }),
    ).toThrow(UnknownGenericFilterValueError);
  });

  it('999md adapter derives postFilter from priceMax and sqmMax', () => {
    const resolved = source999md.resolve({
      ...defaultGenericFilter,
      priceMax: 180_000,
      sqmMax: 150,
    });
    expect(resolved.postFilter).toEqual({ maxPriceEur: 180_000, maxAreaSqm: 150 });
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

import { describe, expect, it } from 'vitest';

import { FILTER } from '../config.js';
import { buildSearchVariables } from '../graphql.js';

describe('buildSearchVariables', () => {
  it('uses the resolved searchInput when one is supplied', () => {
    const override = {
      subCategoryId: 9999,
      source: 'AD_SOURCE_DESKTOP' as const,
      filters: [{ filterId: 99, features: [{ featureId: 88, optionIds: [77] }] }],
    };
    const vars = buildSearchVariables(0, override) as {
      input: { subCategoryId: number; pagination: { limit: number; skip: number } };
    };
    expect(vars.input.subCategoryId).toBe(9999);
    expect(vars.input.pagination.limit).toBe(FILTER.pageSize);
    expect(vars.input.pagination.skip).toBe(0);
  });

  it('falls back to FILTER.searchInput when no override is supplied', () => {
    const vars = buildSearchVariables(2) as {
      input: { subCategoryId: number; pagination: { skip: number } };
    };
    expect(vars.input.subCategoryId).toBe(FILTER.searchInput.subCategoryId);
    expect(vars.input.pagination.skip).toBe(2 * FILTER.pageSize);
  });
});

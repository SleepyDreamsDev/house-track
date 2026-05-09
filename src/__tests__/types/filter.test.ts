import { describe, expect, it } from 'vitest';

import { defaultGenericFilter, genericFilterSchema } from '../../types/filter.js';

describe('genericFilterSchema', () => {
  it('GenericFilter accepts the default sale filter', () => {
    const parsed = genericFilterSchema.safeParse(defaultGenericFilter);
    expect(parsed.success).toBe(true);
  });

  it('GenericFilter rejects priceMin greater than priceMax', () => {
    const parsed = genericFilterSchema.safeParse({
      ...defaultGenericFilter,
      priceMin: 300_000,
      priceMax: 100_000,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('priceMin');
    }
  });

  it('GenericFilter rejects sqmMin greater than sqmMax', () => {
    const parsed = genericFilterSchema.safeParse({
      ...defaultGenericFilter,
      sqmMin: 250,
      sqmMax: 100,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('sqmMin');
    }
  });

  it('GenericFilter rejects an empty locality list', () => {
    const parsed = genericFilterSchema.safeParse({
      ...defaultGenericFilter,
      locality: [],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join('.'));
      expect(paths.some((p) => p.startsWith('locality'))).toBe(true);
    }
  });

  it('GenericFilter rejects a negative price', () => {
    const parsed = genericFilterSchema.safeParse({
      ...defaultGenericFilter,
      priceMax: -1,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('priceMax');
    }
  });
});

import { describe, expect, it } from 'vitest';

import { defaultGenericFilter, genericFilterSchema } from '../../types/filter.js';

describe('genericFilterSchema', () => {
  it('GenericFilter accepts the default filter', () => {
    const parsed = genericFilterSchema.safeParse(defaultGenericFilter);
    expect(parsed.success).toBe(true);
  });

  it('GenericFilter rejects an empty filters array', () => {
    const parsed = genericFilterSchema.safeParse({
      category: 'house',
      filters: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('GenericFilter rejects unknown category', () => {
    const parsed = genericFilterSchema.safeParse({
      category: 'cottage',
      filters: [{ kind: 'options', filterId: 16, featureId: 1, optionIds: [776] }],
    });
    expect(parsed.success).toBe(false);
  });

  it('GenericFilter rejects options selection with empty optionIds', () => {
    const parsed = genericFilterSchema.safeParse({
      category: 'house',
      filters: [{ kind: 'options', filterId: 16, featureId: 1, optionIds: [] }],
    });
    expect(parsed.success).toBe(false);
  });

  it('GenericFilter rejects range selection with min > max', () => {
    const parsed = genericFilterSchema.safeParse({
      category: 'house',
      filters: [
        { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
        { kind: 'range', filterId: 1201, featureId: 588, min: '10', max: '2' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('GenericFilter rejects range selection with neither min nor max', () => {
    const parsed = genericFilterSchema.safeParse({
      category: 'house',
      filters: [
        { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
        { kind: 'range', filterId: 1201, featureId: 588 },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

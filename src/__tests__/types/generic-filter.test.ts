import { describe, expect, it } from 'vitest';

import {
  defaultGenericFilter,
  filterSelectionSchema,
  genericFilterSchema,
} from '../../types/filter.js';

describe('FilterSelection discriminated union', () => {
  it('accepts options kind with ≥1 optionId', () => {
    const r = filterSelectionSchema.safeParse({
      kind: 'options',
      filterId: 16,
      featureId: 1,
      optionIds: [776],
    });
    expect(r.success).toBe(true);
  });

  it('rejects options kind with empty optionIds', () => {
    const r = filterSelectionSchema.safeParse({
      kind: 'options',
      filterId: 16,
      featureId: 1,
      optionIds: [],
    });
    expect(r.success).toBe(false);
  });

  it('accepts range kind with only max', () => {
    const r = filterSelectionSchema.safeParse({
      kind: 'range',
      filterId: 9441,
      featureId: 2,
      unit: 'UNIT_EUR',
      max: '250000',
    });
    expect(r.success).toBe(true);
  });

  it('accepts range kind with only min', () => {
    const r = filterSelectionSchema.safeParse({
      kind: 'range',
      filterId: 1201,
      featureId: 588,
      min: '2',
    });
    expect(r.success).toBe(true);
  });

  it('accepts range kind with both min and max where min≤max', () => {
    const r = filterSelectionSchema.safeParse({
      kind: 'range',
      filterId: 1201,
      featureId: 588,
      min: '2',
      max: '4',
    });
    expect(r.success).toBe(true);
  });

  it('rejects range kind with min > max', () => {
    const r = filterSelectionSchema.safeParse({
      kind: 'range',
      filterId: 1201,
      featureId: 588,
      min: '10',
      max: '2',
    });
    expect(r.success).toBe(false);
  });

  it('rejects range kind with neither min nor max', () => {
    const r = filterSelectionSchema.safeParse({
      kind: 'range',
      filterId: 1201,
      featureId: 588,
    });
    expect(r.success).toBe(false);
  });

  it('accepts boolean kind', () => {
    const r = filterSelectionSchema.safeParse({
      kind: 'boolean',
      filterId: 4132,
      featureId: 171,
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown kind', () => {
    const r = filterSelectionSchema.safeParse({
      kind: 'unknown',
      filterId: 4132,
      featureId: 171,
    });
    expect(r.success).toBe(false);
  });
});

describe('new GenericFilter (category + filters[])', () => {
  it('accepts the new defaultGenericFilter shape', () => {
    const r = genericFilterSchema.safeParse(defaultGenericFilter);
    expect(r.success).toBe(true);
  });

  it('defaultGenericFilter has category:house and 3 filter selections', () => {
    expect(defaultGenericFilter.category).toBe('house');
    expect(defaultGenericFilter.filters).toHaveLength(3);
  });

  it('defaultGenericFilter first selection is offer-type sale', () => {
    const sel = defaultGenericFilter.filters[0];
    expect(sel).toMatchObject({
      kind: 'options',
      filterId: 16,
      featureId: 1,
      optionIds: [776],
    });
  });

  it('defaultGenericFilter second selection is region Chișinău mun.', () => {
    const sel = defaultGenericFilter.filters[1];
    expect(sel).toMatchObject({
      kind: 'options',
      filterId: 32,
      featureId: 7,
      optionIds: [12900],
    });
  });

  it('defaultGenericFilter third selection is price max 250000 EUR', () => {
    const sel = defaultGenericFilter.filters[2];
    expect(sel).toMatchObject({
      kind: 'range',
      filterId: 9441,
      featureId: 2,
      unit: 'UNIT_EUR',
      max: '250000',
    });
  });

  it('rejects an empty filters array', () => {
    const r = genericFilterSchema.safeParse({ category: 'house', filters: [] });
    expect(r.success).toBe(false);
  });

  it('rejects unknown category', () => {
    const r = genericFilterSchema.safeParse({
      category: 'cottage',
      filters: [{ kind: 'options', filterId: 16, featureId: 1, optionIds: [776] }],
    });
    expect(r.success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { source999md } from '../../sources/999md.js';
import { UnknownGenericFilterValueError } from '../../sources/types.js';
import type { GenericFilter } from '../../types/filter.js';
import { defaultGenericFilter } from '../../types/filter.js';

// Minimal valid generic filter for test building
const base: GenericFilter = {
  category: 'house',
  filters: [
    { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
    { kind: 'options', filterId: 32, featureId: 7, optionIds: [12900] },
  ],
};

type AnyFeature = {
  featureId: number;
  optionIds?: number[];
  unit?: string;
  range?: { min?: string; max?: string };
};

describe('999md resolver — options kind', () => {
  it('translates options selection to {featureId, optionIds} feature shape matching fixture', () => {
    // fixture: filterId=1193, featureId=247, optionIds=[897]
    const filter: GenericFilter = {
      ...base,
      filters: [
        ...base.filters,
        { kind: 'options', filterId: 1193, featureId: 247, optionIds: [897] },
      ],
    };
    const resolved = source999md.resolve(filter);
    const group = resolved.searchInput.filters.find((f) => f.filterId === 1193);
    expect(group).toBeDefined();
    const feat = group?.features[0] as AnyFeature | undefined;
    expect(feat?.featureId).toBe(247);
    expect(feat?.optionIds).toEqual([897]);
  });
});

describe('999md resolver — range kind (int)', () => {
  it('translates rangeInt selection to {featureId, range:{min,max}} matching fixture', () => {
    // fixture: filterId=1201, featureId=588, range:{min:"2",max:"4"}
    const filter: GenericFilter = {
      ...base,
      filters: [
        ...base.filters,
        { kind: 'range', filterId: 1201, featureId: 588, min: '2', max: '4' },
      ],
    };
    const resolved = source999md.resolve(filter);
    const group = resolved.searchInput.filters.find((f) => f.filterId === 1201);
    expect(group).toBeDefined();
    expect(group?.features[0]).toEqual({ featureId: 588, range: { min: '2', max: '4' } });
  });

  it('emits range with only min when max absent', () => {
    const filter: GenericFilter = {
      ...base,
      filters: [...base.filters, { kind: 'range', filterId: 1201, featureId: 588, min: '2' }],
    };
    const resolved = source999md.resolve(filter);
    const group = resolved.searchInput.filters.find((f) => f.filterId === 1201);
    expect(group?.features[0]).toEqual({ featureId: 588, range: { min: '2' } });
  });

  it('emits range with only max when min absent', () => {
    const filter: GenericFilter = {
      ...base,
      filters: [...base.filters, { kind: 'range', filterId: 1201, featureId: 588, max: '4' }],
    };
    const resolved = source999md.resolve(filter);
    const group = resolved.searchInput.filters.find((f) => f.filterId === 1201);
    expect(group?.features[0]).toEqual({ featureId: 588, range: { max: '4' } });
  });
});

describe('999md resolver — range kind (unit)', () => {
  it('translates rangeUnit selection to {featureId, unit, range} matching fixture', () => {
    // fixture: filterId=1073, featureId=244, unit="UNIT_METER_SQUARE", range:{min:"50",max:"200"}
    const filter: GenericFilter = {
      ...base,
      filters: [
        ...base.filters,
        {
          kind: 'range',
          filterId: 1073,
          featureId: 244,
          unit: 'UNIT_METER_SQUARE',
          min: '50',
          max: '200',
        },
      ],
    };
    const resolved = source999md.resolve(filter);
    const group = resolved.searchInput.filters.find((f) => f.filterId === 1073);
    expect(group?.features[0]).toEqual({
      featureId: 244,
      unit: 'UNIT_METER_SQUARE',
      range: { min: '50', max: '200' },
    });
  });
});

describe('999md resolver — boolean kind', () => {
  it('translates boolean selection to bare {featureId} matching fixture', () => {
    // fixture: filterId=4132, featureId=171
    const filter: GenericFilter = {
      ...base,
      filters: [...base.filters, { kind: 'boolean', filterId: 4132, featureId: 171 }],
    };
    const resolved = source999md.resolve(filter);
    const group = resolved.searchInput.filters.find((f) => f.filterId === 4132);
    expect(group).toBeDefined();
    expect(group?.features[0]).toEqual({ featureId: 171 });
  });

  it('AND-merges multiple boolean features under same filterId', () => {
    const filter: GenericFilter = {
      ...base,
      filters: [
        ...base.filters,
        { kind: 'boolean', filterId: 4132, featureId: 171 },
        { kind: 'boolean', filterId: 4132, featureId: 232 },
      ],
    };
    const resolved = source999md.resolve(filter);
    const group = resolved.searchInput.filters.find((f) => f.filterId === 4132);
    expect(group?.features).toHaveLength(2);
    const featureIds = group?.features.map((f) => f.featureId) ?? [];
    expect(featureIds).toContain(171);
    expect(featureIds).toContain(232);
  });
});

describe('999md resolver — price special-case (filterId 9441)', () => {
  it('price range goes to postFilter, not searchInput', () => {
    const filter: GenericFilter = {
      ...base,
      filters: [
        ...base.filters,
        { kind: 'range', filterId: 9441, featureId: 2, unit: 'UNIT_EUR', max: '250000' },
      ],
    };
    const resolved = source999md.resolve(filter);
    expect(resolved.searchInput.filters.find((f) => f.filterId === 9441)).toBeUndefined();
    expect(resolved.postFilter.maxPriceEur).toBe(250_000);
  });

  it('price with min sets minPriceEur', () => {
    const filter: GenericFilter = {
      ...base,
      filters: [
        ...base.filters,
        { kind: 'range', filterId: 9441, featureId: 2, unit: 'UNIT_EUR', min: '50000' },
      ],
    };
    const resolved = source999md.resolve(filter);
    expect(resolved.postFilter.minPriceEur).toBe(50_000);
    expect(resolved.postFilter.maxPriceEur).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('no price selection → sentinels 0 / Number.MAX_SAFE_INTEGER', () => {
    const resolved = source999md.resolve({ ...base });
    expect(resolved.postFilter.minPriceEur).toBe(0);
    expect(resolved.postFilter.maxPriceEur).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('999md resolver — category mapping', () => {
  it('house → subCategoryId 1406', () => {
    const resolved = source999md.resolve({ ...base, category: 'house' });
    expect(resolved.searchInput.subCategoryId).toBe(1406);
  });

  it('apartment → subCategoryId 1404', () => {
    const resolved = source999md.resolve({ ...base, category: 'apartment' });
    expect(resolved.searchInput.subCategoryId).toBe(1404);
  });

  it('unknown category throws UnknownGenericFilterValueError with field=category', () => {
    expect(() => source999md.resolve({ ...base, category: 'cottage' as never })).toThrow(
      UnknownGenericFilterValueError,
    );
  });
});

describe('999md resolver — taxonomy validation', () => {
  it('unknown filterId throws UnknownGenericFilterValueError', () => {
    const filter: GenericFilter = {
      ...base,
      filters: [
        ...base.filters,
        { kind: 'options', filterId: 99999, featureId: 1, optionIds: [776] },
      ],
    };
    expect(() => source999md.resolve(filter)).toThrow(UnknownGenericFilterValueError);
  });

  it('unknown featureId throws UnknownGenericFilterValueError', () => {
    const filter: GenericFilter = {
      ...base,
      filters: [
        ...base.filters,
        { kind: 'options', filterId: 16, featureId: 99999, optionIds: [776] },
      ],
    };
    expect(() => source999md.resolve(filter)).toThrow(UnknownGenericFilterValueError);
  });

  it('unknown optionId throws UnknownGenericFilterValueError', () => {
    const filter: GenericFilter = {
      ...base,
      filters: [
        ...base.filters,
        { kind: 'options', filterId: 16, featureId: 1, optionIds: [99999] },
      ],
    };
    expect(() => source999md.resolve(filter)).toThrow(UnknownGenericFilterValueError);
  });

  it('unknown unit throws UnknownGenericFilterValueError', () => {
    const filter: GenericFilter = {
      ...base,
      filters: [
        ...base.filters,
        { kind: 'range', filterId: 1073, featureId: 244, unit: 'UNIT_PARSEC', min: '10' },
      ],
    };
    expect(() => source999md.resolve(filter)).toThrow(UnknownGenericFilterValueError);
  });
});

describe('999md resolver — default resolves correctly', () => {
  it('default filter resolves without error', () => {
    expect(() => source999md.resolve(defaultGenericFilter)).not.toThrow();
  });

  it('default filter has offer-type and region in searchInput', () => {
    const resolved = source999md.resolve(defaultGenericFilter);
    const offerGroup = resolved.searchInput.filters.find((f) => f.filterId === 16);
    const regionGroup = resolved.searchInput.filters.find((f) => f.filterId === 32);
    expect(offerGroup).toBeDefined();
    expect(regionGroup).toBeDefined();
  });

  it('default filter price goes to postFilter', () => {
    const resolved = source999md.resolve(defaultGenericFilter);
    expect(resolved.postFilter.maxPriceEur).toBe(250_000);
    expect(resolved.searchInput.filters.find((f) => f.filterId === 9441)).toBeUndefined();
  });

  it('source field is AD_SOURCE_DESKTOP_REDESIGN', () => {
    const resolved = source999md.resolve(defaultGenericFilter);
    expect(resolved.searchInput.source).toBe('AD_SOURCE_DESKTOP_REDESIGN');
  });
});

describe('999md resolver — AND-merge (multi-selection same filterId)', () => {
  it('two optionIds for same featureId are merged into one feature entry', () => {
    const filter: GenericFilter = {
      category: 'house',
      filters: [
        { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
        { kind: 'options', filterId: 32, featureId: 7, optionIds: [12900, 12885] },
      ],
    };
    const resolved = source999md.resolve(filter);
    const regionGroup = resolved.searchInput.filters.find((f) => f.filterId === 32);
    const feat = regionGroup?.features[0] as AnyFeature | undefined;
    expect(feat?.optionIds).toContain(12900);
    expect(feat?.optionIds).toContain(12885);
  });
});

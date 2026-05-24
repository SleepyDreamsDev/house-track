import { describe, expect, it } from 'vitest';

import { applyPostFilter } from '../parse-index.js';

const make = (id: string, priceEur: number | null, areaSqm: number | null) => ({
  id,
  url: `https://999.md/ro/${id}`,
  title: `t${id}`,
  priceEur,
  priceRaw: priceEur === null ? null : `${priceEur} EUR`,
  areaSqm,
  postedAt: null,
});

describe('applyPostFilter — new shape with minPriceEur', () => {
  it('drops listings below minPriceEur', () => {
    const stubs = [make('A', 50_000, 120), make('B', 150_000, 120)];
    const kept = applyPostFilter(stubs, {
      minPriceEur: 100_000,
      maxPriceEur: Number.MAX_SAFE_INTEGER,
    });
    expect(kept.map((s) => s.id)).toEqual(['B']);
  });

  it('keeps listings with priceEur === minPriceEur (inclusive floor)', () => {
    const stubs = [make('A', 100_000, 120)];
    const kept = applyPostFilter(stubs, {
      minPriceEur: 100_000,
      maxPriceEur: Number.MAX_SAFE_INTEGER,
    });
    expect(kept.map((s) => s.id)).toEqual(['A']);
  });

  it('sentinel minPriceEur=0 passes everything through', () => {
    const stubs = [make('A', 1_000, 120)];
    const kept = applyPostFilter(stubs, {
      minPriceEur: 0,
      maxPriceEur: Number.MAX_SAFE_INTEGER,
    });
    expect(kept.map((s) => s.id)).toEqual(['A']);
  });

  it('keeps listings with null priceEur (unknown currency)', () => {
    const stubs = [make('A', null, 120)];
    const kept = applyPostFilter(stubs, {
      minPriceEur: 100_000,
      maxPriceEur: 250_000,
    });
    expect(kept.map((s) => s.id)).toEqual(['A']);
  });

  it('does not filter by area (area is now source-level)', () => {
    const stubs = [make('A', 100_000, 999)];
    const kept = applyPostFilter(stubs, {
      minPriceEur: 0,
      maxPriceEur: 250_000,
    });
    expect(kept.map((s) => s.id)).toEqual(['A']);
  });

  it('still drops listings above maxPriceEur', () => {
    const stubs = [make('A', 300_000, 120)];
    const kept = applyPostFilter(stubs, {
      minPriceEur: 0,
      maxPriceEur: 250_000,
    });
    expect(kept).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';

import { marketTemperature, zScores, type SegmentComponents } from '../market-index.js';

describe('zScores', () => {
  it('standardizes to mean 0, unit std', () => {
    const z = zScores([1, 2, 3, 4, 5]);
    expect(z[0]).toBeCloseTo(-1.414, 2);
    expect(z[2]).toBeCloseTo(0, 5);
    expect(z[4]).toBeCloseTo(1.414, 2);
  });

  it('returns zeros when there is no spread', () => {
    expect(zScores([7, 7, 7])).toEqual([0, 0, 0]);
  });
});

describe('marketTemperature', () => {
  const hot: SegmentComponents = {
    key: 'Hot',
    inventory: 10, // scarce
    medianDomClosed: 15, // sells fast
    absorptionMonths: 1, // low overhang
    distressShare: 0.05, // few motivated sellers
    newListingPremium: 1.2, // fresh asks test higher
  };
  const cold: SegmentComponents = {
    key: 'Cold',
    inventory: 200, // glut
    medianDomClosed: 180, // sits
    absorptionMonths: 12, // huge overhang
    distressShare: 0.6, // many motivated sellers
    newListingPremium: 0.85, // fresh asks discount
  };
  const mid: SegmentComponents = {
    key: 'Mid',
    inventory: 100,
    medianDomClosed: 90,
    absorptionMonths: 6,
    distressShare: 0.3,
    newListingPremium: 1.0,
  };

  it('ranks the hot segment highest and the cold segment lowest', () => {
    const { segments } = marketTemperature([cold, mid, hot]);
    expect(segments[0]!.key).toBe('Hot');
    expect(segments[segments.length - 1]!.key).toBe('Cold');
    expect(segments[0]!.temperatureScore).toBeGreaterThan(segments[2]!.temperatureScore);
  });

  it('labels power: hot → sellers, cold → buyers', () => {
    const { segments, summary } = marketTemperature([cold, mid, hot]);
    const byKey = Object.fromEntries(segments.map((s) => [s.key, s.power]));
    expect(byKey.Hot).toBe('sellers');
    expect(byKey.Cold).toBe('buyers');
    expect(summary.sellers).toBeGreaterThanOrEqual(1);
    expect(summary.buyers).toBeGreaterThanOrEqual(1);
  });

  it('treats a null component as neutral (does not skew the blend)', () => {
    const withNulls: SegmentComponents = {
      ...mid,
      key: 'Sparse',
      medianDomClosed: null,
      absorptionMonths: null,
    };
    const { segments } = marketTemperature([hot, cold, withNulls]);
    const sparse = segments.find((s) => s.key === 'Sparse');
    expect(sparse).toBeDefined();
    expect(Number.isFinite(sparse!.temperatureScore)).toBe(true);
  });

  it('returns an empty result for no segments', () => {
    expect(marketTemperature([])).toEqual({
      segments: [],
      summary: { buyers: 0, balanced: 0, sellers: 0 },
    });
  });
});

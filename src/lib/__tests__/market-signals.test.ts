import { describe, expect, it } from 'vitest';

import {
  absorptionMonths,
  iqr,
  medianDomClosed,
  newListingPremium,
  priceBand,
  realizedDomDays,
  repricingVelocity,
  segmentStats,
  sellerMix,
  timeToFirstCutDays,
  turnoverRatio,
  type SegmentListing,
} from '../market-signals.js';

const DAY = 24 * 60 * 60 * 1000;
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * DAY);

describe('priceBand', () => {
  it('Price band buckets a price into a fixed EUR band', () => {
    expect(priceBand(35_000)).toBe('<40k');
    expect(priceBand(55_000)).toBe('40-70k');
    expect(priceBand(85_000)).toBe('70-100k');
    expect(priceBand(120_000)).toBe('100-150k');
    expect(priceBand(200_000)).toBe('150k+');
  });

  it('Price band is "unknown" for a null price', () => {
    expect(priceBand(null)).toBe('unknown');
  });

  it('bands are inclusive at the lower edge', () => {
    expect(priceBand(40_000)).toBe('40-70k');
    expect(priceBand(150_000)).toBe('150k+');
  });
});

describe('iqr', () => {
  it('Euro-per-sqm IQR is the interquartile range', () => {
    // n=8 → Q1 idx 1.75 = 2.75, Q3 idx 5.25 = 6.25 → IQR 3.5
    expect(iqr([1, 2, 3, 4, 5, 6, 7, 8])).toBeCloseTo(3.5, 5);
  });

  it('is 0 for an empty set', () => {
    expect(iqr([])).toBe(0);
  });
});

describe('realizedDomDays / medianDomClosed', () => {
  it('Realized DOM uses delistedAt over closed listings only', () => {
    const closed = { firstSeenAt: day(0), delistedAt: day(30) };
    const active = { firstSeenAt: day(0), delistedAt: null };
    expect(realizedDomDays(closed)).toBe(30);
    expect(realizedDomDays(active)).toBeNull();
    expect(medianDomClosed([closed, active])).toBe(30);
  });

  it('medianDomClosed is 0 when nothing has closed', () => {
    expect(medianDomClosed([{ firstSeenAt: day(0), delistedAt: null }])).toBe(0);
  });
});

describe('absorptionMonths', () => {
  it('Absorption is active inventory divided by monthly delist rate', () => {
    expect(absorptionMonths(60, 12)).toBe(5);
  });

  it('Absorption is null when there are no recent delists', () => {
    expect(absorptionMonths(60, 0)).toBeNull();
  });
});

describe('turnoverRatio', () => {
  it('is delists over average inventory', () => {
    expect(turnoverRatio(10, 40)).toBe(0.25);
  });

  it('is null when there is no inventory', () => {
    expect(turnoverRatio(10, 0)).toBeNull();
  });
});

describe('repricingVelocity', () => {
  it('Repricing velocity averages consecutive snapshot deltas', () => {
    expect(repricingVelocity([100_000, 95_000, 90_000])).toBe(-5_000);
  });

  it('is 0 with fewer than two prices', () => {
    expect(repricingVelocity([100_000])).toBe(0);
  });
});

describe('timeToFirstCutDays', () => {
  it('measures days to the first observed price drop', () => {
    const snaps = [
      { capturedAt: day(0), priceEur: 100_000 },
      { capturedAt: day(5), priceEur: 100_000 },
      { capturedAt: day(10), priceEur: 95_000 },
    ];
    expect(timeToFirstCutDays(day(0), snaps)).toBe(10);
  });

  it('is null when no drop is observed', () => {
    const snaps = [
      { capturedAt: day(0), priceEur: 100_000 },
      { capturedAt: day(5), priceEur: 105_000 },
    ];
    expect(timeToFirstCutDays(day(0), snaps)).toBeNull();
  });
});

describe('newListingPremium', () => {
  it('ratios fresh asks against standing median', () => {
    // median(fresh)=1100, median(standing)=1000 → 1.1
    expect(newListingPremium([1000, 1100, 1200], [900, 1000, 1100])).toBeCloseTo(1.1, 5);
  });

  it('is null when the standing median is zero', () => {
    expect(newListingPremium([1000], [])).toBeNull();
  });
});

describe('sellerMix', () => {
  it('splits agency vs private vs unknown shares', () => {
    const mix = sellerMix(['private', 'private', 'agency', null]);
    expect(mix.private).toBeCloseTo(0.5, 5);
    expect(mix.agency).toBeCloseTo(0.25, 5);
    expect(mix.unknown).toBeCloseTo(0.25, 5);
  });

  it('is all-zero for an empty input', () => {
    expect(sellerMix([])).toEqual({ agency: 0, private: 0, unknown: 0 });
  });
});

describe('segmentStats', () => {
  const mk = (over: Partial<SegmentListing>): SegmentListing => ({
    sector: 'Centru',
    rooms: 3,
    priceEur: 100_000,
    areaSqm: 100,
    sellerType: 'private',
    firstSeenAt: day(0),
    delistedAt: null,
    ...over,
  });

  it('groups by sector, rooms and price band and reports count, median and IQR', () => {
    // Keep band/rooms/sector constant (priceEur=100k → "100-150k", rooms 3,
    // Centru) and vary only areaSqm so €/m² disperses within the one segment.
    const seg: SegmentListing[] = [
      mk({ areaSqm: 111 }), // ~901
      mk({ areaSqm: 100 }), // 1000
      mk({ areaSqm: 91 }), // ~1099
      mk({ areaSqm: 83 }), // ~1205
      mk({ areaSqm: 77 }), // ~1299
    ];
    const rows = segmentStats(seg, ['sector', 'rooms', 'priceBand']);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.key).toEqual({ sector: 'Centru', rooms: '3', priceBand: '100-150k' });
    expect(row.count).toBe(5);
    expect(row.medianEurPerSqm).toBeGreaterThan(0);
    expect(row.iqrEurPerSqm).toBeGreaterThan(0);
  });

  it('suppresses a segment below the small-sample floor', () => {
    const seg = [mk({}), mk({}), mk({}), mk({})]; // only 4 < 5
    expect(segmentStats(seg, ['sector', 'rooms', 'priceBand'])).toHaveLength(0);
  });

  it('reports medianDomClosed for delisted members and null otherwise', () => {
    const allActive = Array.from({ length: 5 }, () => mk({}));
    const withClosed = [
      mk({ delistedAt: day(20) }),
      mk({ delistedAt: day(40) }),
      mk({}),
      mk({}),
      mk({}),
    ];
    expect(segmentStats(allActive, ['sector'])[0]!.medianDomClosed).toBeNull();
    expect(segmentStats(withClosed, ['sector'])[0]!.medianDomClosed).toBe(30);
  });
});

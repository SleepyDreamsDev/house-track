// Pins GET_ADVERT_QUERY's shape against parseDetail expectations. Without
// this gate the query can silently regress to a minimal body and live
// detail responses come back without price/region/etc — the 2026-05-09
// outage where every persisted listing had priceEur=null.
//
// 999.md's Advert type uses a generic `feature(id: N)` resolver, not
// direct named fields. The aliases here mirror what SEARCH_ADS_QUERY's
// PriceAndImages fragment uses for the live web client.

import { describe, expect, it } from 'vitest';

import { GET_ADVERT_QUERY } from '../graphql.js';
import { parseDetail } from '../parse-detail.js';
import advertFixture from './fixtures/advert-detail-response.json' with { type: 'json' };

describe('GET_ADVERT_QUERY', () => {
  // alias name → feature id (999.md's stable feature id space)
  const REQUIRED_FEATURES: ReadonlyArray<readonly [string, number]> = [
    ['price', 2],
    ['pricePerMeter', 1385],
    ['body', 13],
    ['region', 7],
    ['city', 8],
    ['street', 10],
    ['mapPoint', 3],
    ['images', 14],
    ['offerType', 1],
  ] as const;

  for (const [alias, featureId] of REQUIRED_FEATURES) {
    it(`aliases feature(id: ${featureId}) as ${alias}`, () => {
      const re = new RegExp(`\\b${alias}:\\s*feature\\(\\s*id:\\s*${featureId}\\s*\\)`);
      expect(GET_ADVERT_QUERY).toMatch(re);
    });
  }

  it('keeps id, state, title, reseted at the top level', () => {
    expect(GET_ADVERT_QUERY).toMatch(/\bid\b/);
    expect(GET_ADVERT_QUERY).toMatch(/\bstate\b/);
    expect(GET_ADVERT_QUERY).toMatch(/\btitle\b/);
    expect(GET_ADVERT_QUERY).toMatch(/\breseted\b/);
  });

  it('declares a FeatureValue fragment with id, type, value', () => {
    expect(GET_ADVERT_QUERY).toMatch(
      /fragment\s+\w+\s+on\s+FeatureValue\s*\{[^}]*\bid\b[^}]*\btype\b[^}]*\bvalue\b/s,
    );
  });

  it('parser extracts non-null priceEur from a fixture-shaped response', () => {
    const parsed = parseDetail('104027607', advertFixture);
    expect(parsed.priceEur).toBe(395000);
    expect(parsed.filterValues.length).toBeGreaterThan(0);
  });
});

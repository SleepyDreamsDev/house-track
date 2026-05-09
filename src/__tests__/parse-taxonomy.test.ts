import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bootstrapLutFromConfig, mergeLuts, parseTaxonomyResponse } from '../parse-taxonomy.js';

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/filter-taxonomy-response.json',
);

describe('bootstrapLutFromConfig', () => {
  it('Includes the offer-type anchor (filterId 41, featureId 1)', () => {
    expect(bootstrapLutFromConfig().get(1)).toBe(41);
  });

  it('Includes the region anchor (filterId 40, featureId 7)', () => {
    expect(bootstrapLutFromConfig().get(7)).toBe(40);
  });

  it('Returns no entry for unknown feature ids', () => {
    expect(bootstrapLutFromConfig().get(999_999)).toBeUndefined();
  });
});

describe('parseTaxonomyResponse', () => {
  it('Extracts (filterId → featureId) edges from a nested filters/features tree', () => {
    const json = {
      data: {
        searchFilters: [
          { filterId: 40, label: 'Region', features: [{ featureId: 7, label: 'Region' }] },
          {
            filterId: 41,
            label: 'Offer type',
            features: [{ featureId: 1, label: 'Offer type' }],
          },
          {
            filterId: 99,
            features: [
              { featureId: 13, label: 'Body' },
              { featureId: 14, label: 'Images' },
            ],
          },
        ],
      },
    };
    const lut = parseTaxonomyResponse(json);
    expect(lut.get(7)).toBe(40);
    expect(lut.get(1)).toBe(41);
    expect(lut.get(13)).toBe(99);
    expect(lut.get(14)).toBe(99);
  });

  it('Falls back to `id` when the response uses id/features instead of filterId/features', () => {
    const json = [{ id: 50, features: [{ id: 20 }, { id: 21 }] }];
    const lut = parseTaxonomyResponse(json);
    expect(lut.get(20)).toBe(50);
    expect(lut.get(21)).toBe(50);
  });

  it('Returns an empty LUT for unrecognized shapes', () => {
    expect(parseTaxonomyResponse({ unrelated: { foo: 1 } }).size).toBe(0);
    expect(parseTaxonomyResponse(null).size).toBe(0);
    expect(parseTaxonomyResponse('not an object').size).toBe(0);
  });
});

describe('parseTaxonomyResponse against the real captured fixture', () => {
  const captured = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as unknown;
  const lut = parseTaxonomyResponse(captured);

  it('Resolves featureId 1 (offer type) to filterId 16 — diverges from src/config.ts', () => {
    expect(lut.get(1)).toBe(16);
  });

  it('Resolves featureId 7 (region) to filterId 32 — diverges from src/config.ts', () => {
    expect(lut.get(7)).toBe(32);
  });

  it('Captures multiple features that share the same filter group', () => {
    // filterId 32 (Regiune) groups several features: 7 (Region), 8 (City), 9 (Sector).
    expect(lut.get(7)).toBe(32);
    expect(lut.get(8)).toBe(32);
    expect(lut.get(9)).toBe(32);
  });

  it('Captures at least 10 distinct featureId → filterId edges from the live response', () => {
    expect(lut.size).toBeGreaterThanOrEqual(10);
  });
});

describe('mergeLuts', () => {
  it('Captured entries override bootstrap entries on conflict', () => {
    const bootstrap = new Map([[7, 40]]);
    const captured = new Map([[7, 999]]);
    expect(mergeLuts(bootstrap, captured).get(7)).toBe(999);
  });

  it('Combines disjoint entries from both sides', () => {
    const a = new Map([[1, 41]]);
    const b = new Map([[7, 40]]);
    const merged = mergeLuts(a, b);
    expect(merged.get(1)).toBe(41);
    expect(merged.get(7)).toBe(40);
    expect(merged.size).toBe(2);
  });
});

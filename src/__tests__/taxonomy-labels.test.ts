import { describe, expect, it } from 'vitest';

import {
  buildTaxonomyResponse,
  getFeatureLabel,
  getFilterLabel,
  getOptionLabel,
  taxonomyStats,
} from '../taxonomy-labels.js';

describe('taxonomy labels — default (1406 house)', () => {
  it('loads at least one filter, feature, and option from the captured taxonomy', () => {
    const stats = taxonomyStats();
    expect(stats.filters).toBeGreaterThan(0);
    expect(stats.features).toBeGreaterThan(0);
    expect(stats.options).toBeGreaterThan(0);
  });

  it('resolves the offer-type filter group to "Tip ofertă" for house (1406)', () => {
    expect(getFilterLabel(16, 1406)).toBe('Tip ofertă');
  });

  it('resolves filterId 16 / featureId 1 / optionId 776 to "Vând" for house (1406)', () => {
    expect(getOptionLabel(16, 1, 776, 1406)).toBe('Vând');
  });

  it('returns null for unknown ids in house taxonomy', () => {
    expect(getFilterLabel(999_999, 1406)).toBeNull();
    expect(getFeatureLabel(999_999, 1, 1406)).toBeNull();
    expect(getOptionLabel(16, 1, 999_999, 1406)).toBeNull();
  });
});

describe('taxonomy labels — apartment (1404)', () => {
  it('resolves the offer-type filter group to "Tip ofertă" for apartment (1404)', () => {
    expect(getFilterLabel(16, 1404)).toBe('Tip ofertă');
  });

  it('resolves filterId 16 / featureId 1 / optionId 776 to "Vând" for apartment (1404)', () => {
    expect(getOptionLabel(16, 1, 776, 1404)).toBe('Vând');
  });

  it('returns null for unknown ids in apartment taxonomy', () => {
    expect(getFilterLabel(999_999, 1404)).toBeNull();
    expect(getFeatureLabel(999_999, 1, 1404)).toBeNull();
    expect(getOptionLabel(16, 1, 999_999, 1404)).toBeNull();
  });
});

describe('buildTaxonomyResponse — house vs apartment differences', () => {
  it('house taxonomy (1406) contains Stare casă (1207) but not Etaj (1191)', () => {
    const house = buildTaxonomyResponse(1406);
    const stareIds = house.map((f) => f.filterId);
    expect(stareIds).toContain(1207); // Stare casă — house only
    expect(stareIds).not.toContain(1191); // Etaj — apartment only
  });

  it('apartment taxonomy (1404) contains Etaj (1191) but not Stare casă (1207)', () => {
    const apt = buildTaxonomyResponse(1404);
    const aptIds = apt.map((f) => f.filterId);
    expect(aptIds).toContain(1191); // Etaj — apartment only
    expect(aptIds).not.toContain(1207); // Stare casă — house only
  });

  it('both taxonomies contain universal filters: offer-type (16), region (32), price (9441)', () => {
    const house = buildTaxonomyResponse(1406);
    const apt = buildTaxonomyResponse(1404);
    for (const id of [16, 32, 9441]) {
      expect(house.map((f) => f.filterId)).toContain(id);
      expect(apt.map((f) => f.filterId)).toContain(id);
    }
  });

  it('unknown subCategoryId returns empty array', () => {
    expect(buildTaxonomyResponse(9999)).toEqual([]);
  });

  it('each item has filterId, label, kind, features[]', () => {
    const house = buildTaxonomyResponse(1406);
    for (const item of house.slice(0, 3)) {
      expect(typeof item.filterId).toBe('number');
      expect(typeof item.label).toBe('string');
      expect(['options', 'range', 'boolean']).toContain(item.kind);
      expect(Array.isArray(item.features)).toBe(true);
    }
  });
});

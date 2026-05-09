import { describe, expect, it } from 'vitest';

import {
  getFeatureLabel,
  getFilterLabel,
  getOptionLabel,
  taxonomyStats,
} from '../taxonomy-labels.js';

describe('taxonomy labels', () => {
  it('loads at least one filter, feature, and option from the captured taxonomy', () => {
    const stats = taxonomyStats();
    expect(stats.filters).toBeGreaterThan(0);
    expect(stats.features).toBeGreaterThan(0);
    expect(stats.options).toBeGreaterThan(0);
  });

  it('resolves the offer-type filter group to "Tip ofertă"', () => {
    expect(getFilterLabel(16)).toBe('Tip ofertă');
  });

  it('resolves filterId 16 / featureId 1 / optionId 776 to "Vând"', () => {
    expect(getOptionLabel(16, 1, 776)).toBe('Vând');
  });

  it('returns null for unknown ids', () => {
    expect(getFilterLabel(999_999)).toBeNull();
    expect(getFeatureLabel(999_999, 1)).toBeNull();
    expect(getOptionLabel(16, 1, 999_999)).toBeNull();
  });
});

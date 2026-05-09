import type { GenericFilter } from '../types/filter.js';

export interface ResolvedSearchInput {
  subCategoryId: number;
  source: 'AD_SOURCE_DESKTOP';
  filters: ReadonlyArray<{
    filterId: number;
    features: ReadonlyArray<{ featureId: number; optionIds: number[] }>;
  }>;
}

export interface ResolvedFilter {
  searchInput: ResolvedSearchInput;
  // Always non-optional — sentinel `Number.MAX_SAFE_INTEGER` denotes "no cap"
  // so applyPostFilter (which expects a concrete cap pair) doesn't have to
  // branch on undefined.
  postFilter: {
    maxPriceEur: number;
    maxAreaSqm: number;
  };
}

export interface Source {
  slug: string;
  name: string;
  resolve: (generic: GenericFilter) => ResolvedFilter;
}

// Thrown by a source's resolve() when the generic filter contains a value
// the mapping table does not cover. The HTTP layer surfaces this as 400 so
// the operator can see exactly which field was rejected.
export class UnknownGenericFilterValueError extends Error {
  readonly field: string;
  readonly value: string;

  constructor(field: string, value: string) {
    super(`Unknown ${field} value "${value}" — not in source mapping`);
    this.name = 'UnknownGenericFilterValueError';
    this.field = field;
    this.value = value;
  }
}

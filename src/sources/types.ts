import type { GenericFilter } from '../types/filter.js';

export type ResolvedFeature =
  | { featureId: number }
  | { featureId: number; optionIds: number[] }
  | { featureId: number; unit?: string; range: { min?: string; max?: string } };

export interface ResolvedSearchInput {
  subCategoryId: number;
  source: 'AD_SOURCE_DESKTOP' | 'AD_SOURCE_DESKTOP_REDESIGN';
  filters: ReadonlyArray<{
    filterId: number;
    features: ReadonlyArray<ResolvedFeature>;
  }>;
}

export interface ResolvedFilter {
  searchInput: ResolvedSearchInput;
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

// Reads the persisted generic filter from the Setting table and resolves it
// through the active source's mapping. Falls back to the FILTER constant in
// src/config.ts when no setting is present so production keeps working
// before any operator has touched the form.

import { FILTER } from './config.js';
import { ACTIVE_SOURCE_SLUG, getSource } from './sources/index.js';
import type { ResolvedFilter } from './sources/types.js';
import { defaultGenericFilter, genericFilterSchema } from './types/filter.js';
import type { GenericFilter } from './types/filter.js';
import { getSetting } from './settings.js';

export interface ResolvedActiveFilter extends ResolvedFilter {
  sourceSlug: string;
  generic: GenericFilter;
}

export async function resolveActiveFilter(): Promise<ResolvedActiveFilter> {
  const sourceSlug = ACTIVE_SOURCE_SLUG;
  const source = getSource(sourceSlug);
  if (!source) {
    return fallback(sourceSlug);
  }

  const stored = await getSetting<unknown>('filter.generic', null);
  if (stored === null || stored === undefined) {
    return fallback(sourceSlug);
  }

  const parsed = genericFilterSchema.safeParse(stored);
  if (!parsed.success) {
    return fallback(sourceSlug);
  }

  const generic = parsed.data;
  const resolved = source.resolve(generic);
  return { ...resolved, sourceSlug, generic };
}

function fallback(sourceSlug: string): ResolvedActiveFilter {
  return {
    sourceSlug,
    generic: defaultGenericFilter,
    searchInput: {
      subCategoryId: FILTER.searchInput.subCategoryId,
      source: FILTER.searchInput.source,
      filters: FILTER.searchInput.filters.map((f) => ({
        filterId: f.filterId,
        features: f.features.map((feat) => ({
          featureId: feat.featureId,
          optionIds: [...feat.optionIds],
        })),
      })),
    },
    postFilter: { ...FILTER.postFilter },
  };
}

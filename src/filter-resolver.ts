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
      filters: (
        FILTER.searchInput.filters as unknown as Array<{
          filterId: number;
          features: Array<{
            featureId: number;
            optionIds?: readonly number[];
            unit?: string;
            range?: { min?: string; max?: string };
          }>;
        }>
      ).map((f) => ({
        filterId: f.filterId,
        features: f.features.map((feat) => {
          if (feat.optionIds !== undefined) {
            return { featureId: feat.featureId, optionIds: [...feat.optionIds] };
          }
          if (feat.range !== undefined) {
            const entry: {
              featureId: number;
              unit?: string;
              range: { min?: string; max?: string };
            } = {
              featureId: feat.featureId,
              range: { ...feat.range },
            };
            if (feat.unit !== undefined) entry.unit = feat.unit;
            return entry;
          }
          return { featureId: feat.featureId };
        }),
      })),
    },
  };
}

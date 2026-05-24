// 999.md adapter — translates GenericFilter into the GraphQL searchInput
// shape that lives in src/config.ts FILTER.searchInput.
//
// Param IDs were captured from a real browser session per CLAUDE.md.
// Each unmapped value at runtime throws UnknownGenericFilterValueError
// rather than silently dropping — see src/types/filter.ts module header.

import taxonomyJson from '../data/filter-taxonomy.json' with { type: 'json' };
import type { Category, FilterSelection, GenericFilter } from '../types/filter.js';
import type { ResolvedFeature, ResolvedFilter, Source } from './types.js';
import { UnknownGenericFilterValueError } from './types.js';

const CATEGORY_SUBCATEGORY_MAP: Record<Category, number> = {
  house: 1406,
  apartment: 1404,
};

const PRICE_FILTER_ID = 9441;

interface RawTitle {
  translated?: string;
}
interface RawOption {
  id: number;
  title?: RawTitle;
}
interface RawFeature {
  id: number;
  type?: string;
  title?: RawTitle;
  options?: RawOption[];
}
interface RawFilter {
  id: number;
  type?: string;
  title?: RawTitle;
  units?: string[] | null;
  features?: RawFeature[];
}
interface RawTaxonomy {
  data?: { category?: { filters?: RawFilter[] } };
}

const taxonomy = (taxonomyJson as RawTaxonomy).data?.category?.filters ?? [];
const filterById = new Map<number, RawFilter>(taxonomy.map((f) => [f.id, f]));

function getFilter(filterId: number): RawFilter {
  const f = filterById.get(filterId);
  if (!f) throw new UnknownGenericFilterValueError('filterId', String(filterId));
  return f;
}

function getFeature(filter: RawFilter, featureId: number): RawFeature {
  const feat = (filter.features ?? []).find((f) => f.id === featureId);
  if (!feat) throw new UnknownGenericFilterValueError('featureId', String(featureId));
  return feat;
}

function validateOptionId(feature: RawFeature, optionId: number): void {
  const opt = (feature.options ?? []).find((o) => o.id === optionId);
  if (!opt) throw new UnknownGenericFilterValueError('optionId', String(optionId));
}

function validateUnit(filter: RawFilter, unit: string): void {
  const units = filter.units ?? [];
  if (!units.includes(unit)) throw new UnknownGenericFilterValueError('unit', unit);
}

type ResolvedFilterEntry = {
  filterId: number;
  features: ResolvedFeature[];
};

function mergeIntoFilters(
  byFilterId: Map<number, Map<string, ResolvedFeature>>,
  filterId: number,
  featureId: number,
  feature: ResolvedFeature,
): void {
  let byFeatureId = byFilterId.get(filterId);
  if (!byFeatureId) {
    byFeatureId = new Map();
    byFilterId.set(filterId, byFeatureId);
  }
  const key = String(featureId);
  const existing = byFeatureId.get(key);
  if (!existing) {
    byFeatureId.set(key, feature);
    return;
  }
  // Merge optionIds for options features
  if ('optionIds' in existing && 'optionIds' in feature) {
    for (const id of feature.optionIds) {
      if (!existing.optionIds.includes(id)) existing.optionIds.push(id);
    }
    return;
  }
  // For range and boolean: last write wins (they're single-valued per featureId)
  byFeatureId.set(key, feature);
}

function buildFilters(
  byFilterId: Map<number, Map<string, ResolvedFeature>>,
): ResolvedFilterEntry[] {
  const result: ResolvedFilterEntry[] = [];
  for (const [filterId, byFeatureId] of byFilterId) {
    result.push({ filterId, features: [...byFeatureId.values()] });
  }
  return result;
}

function translateSelection(
  sel: FilterSelection,
): { filterId: number; featureId: number; feature: ResolvedFeature } | null {
  const filter = getFilter(sel.filterId);
  const feat = getFeature(filter, sel.featureId);

  if (sel.kind === 'options') {
    for (const optionId of sel.optionIds) {
      validateOptionId(feat, optionId);
    }
    return {
      filterId: sel.filterId,
      featureId: sel.featureId,
      feature: { featureId: sel.featureId, optionIds: [...sel.optionIds] },
    };
  }

  if (sel.kind === 'range') {
    if (sel.unit !== undefined) validateUnit(filter, sel.unit);
    const range: { min?: string; max?: string } = {};
    if (sel.min !== undefined) range.min = sel.min;
    if (sel.max !== undefined) range.max = sel.max;
    if (sel.unit !== undefined) {
      return {
        filterId: sel.filterId,
        featureId: sel.featureId,
        feature: { featureId: sel.featureId, unit: sel.unit, range },
      };
    }
    return {
      filterId: sel.filterId,
      featureId: sel.featureId,
      feature: { featureId: sel.featureId, range },
    };
  }

  // boolean
  return {
    filterId: sel.filterId,
    featureId: sel.featureId,
    feature: { featureId: sel.featureId },
  };
}

function resolve(generic: GenericFilter): ResolvedFilter {
  const subCategoryId = CATEGORY_SUBCATEGORY_MAP[generic.category];
  if (subCategoryId === undefined) {
    throw new UnknownGenericFilterValueError('category', String(generic.category));
  }

  const byFilterId = new Map<number, Map<string, ResolvedFeature>>();
  let minPriceEur = 0;
  let maxPriceEur = Number.MAX_SAFE_INTEGER;

  for (const sel of generic.filters) {
    if (sel.kind === 'range' && sel.filterId === PRICE_FILTER_ID) {
      // Validate taxonomy first
      const filter = getFilter(sel.filterId);
      getFeature(filter, sel.featureId);
      if (sel.unit !== undefined) validateUnit(filter, sel.unit);
      if (sel.min !== undefined) minPriceEur = Number(sel.min);
      if (sel.max !== undefined) maxPriceEur = Number(sel.max);
      continue;
    }
    const translated = translateSelection(sel);
    if (translated !== null) {
      mergeIntoFilters(byFilterId, translated.filterId, translated.featureId, translated.feature);
    }
  }

  return {
    searchInput: {
      subCategoryId,
      source: 'AD_SOURCE_DESKTOP_REDESIGN',
      filters: buildFilters(byFilterId),
    },
    postFilter: { minPriceEur, maxPriceEur },
  };
}

export const source999md: Source = {
  slug: '999md',
  name: '999.md',
  resolve,
};

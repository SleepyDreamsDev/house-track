import taxonomy1404Json from '../data/filter-taxonomy.1404.json' with { type: 'json' };
import taxonomy1406Json from '../data/filter-taxonomy.1406.json' with { type: 'json' };
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

function buildFilterMap(json: unknown): Map<number, RawFilter> {
  const filters = (json as RawTaxonomy).data?.category?.filters ?? [];
  return new Map(filters.map((f) => [f.id, f]));
}

const TAXONOMY_BY_SUBCATEGORY = new Map<number, Map<number, RawFilter>>([
  [1406, buildFilterMap(taxonomy1406Json)],
  [1404, buildFilterMap(taxonomy1404Json)],
]);

function getFilter(filterById: Map<number, RawFilter>, filterId: number): RawFilter {
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
  if ('optionIds' in existing && 'optionIds' in feature) {
    for (const id of feature.optionIds) {
      if (!existing.optionIds.includes(id)) existing.optionIds.push(id);
    }
    return;
  }
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
  filterById: Map<number, RawFilter>,
  sel: FilterSelection,
): { filterId: number; featureId: number; feature: ResolvedFeature } | null {
  const filter = getFilter(filterById, sel.filterId);
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

  const filterById = TAXONOMY_BY_SUBCATEGORY.get(subCategoryId);
  if (!filterById) {
    throw new UnknownGenericFilterValueError('category', String(generic.category));
  }

  const byFilterId = new Map<number, Map<string, ResolvedFeature>>();
  let minPriceEur = 0;
  let maxPriceEur = Number.MAX_SAFE_INTEGER;

  for (const sel of generic.filters) {
    if (sel.kind === 'range' && sel.filterId === PRICE_FILTER_ID) {
      const filter = getFilter(filterById, sel.filterId);
      getFeature(filter, sel.featureId);
      if (sel.unit !== undefined) validateUnit(filter, sel.unit);
      if (sel.min !== undefined) minPriceEur = Number(sel.min);
      if (sel.max !== undefined) maxPriceEur = Number(sel.max);
      continue;
    }
    const translated = translateSelection(filterById, sel);
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

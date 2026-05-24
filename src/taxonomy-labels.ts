import taxonomy1404Json from './data/filter-taxonomy.1404.json' with { type: 'json' };
import taxonomy1406Json from './data/filter-taxonomy.1406.json' with { type: 'json' };

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
  data?: {
    category?: {
      filters?: RawFilter[];
    };
  };
}

interface TaxonomyIndex {
  filterLabels: Map<number, string>;
  featureLabels: Map<string, string>;
  optionLabels: Map<string, string>;
  rawFilters: RawFilter[];
}

function buildIndex(json: unknown): TaxonomyIndex {
  const filterLabels = new Map<number, string>();
  const featureLabels = new Map<string, string>();
  const optionLabels = new Map<string, string>();

  const root = json as RawTaxonomy;
  const filters = root.data?.category?.filters ?? [];
  for (const f of filters) {
    if (typeof f.id !== 'number') continue;
    const fLabel = f.title?.translated;
    if (fLabel) filterLabels.set(f.id, fLabel);
    for (const feat of f.features ?? []) {
      if (typeof feat.id !== 'number') continue;
      const featLabel = feat.title?.translated;
      if (featLabel) featureLabels.set(`${f.id}:${feat.id}`, featLabel);
      for (const opt of feat.options ?? []) {
        if (typeof opt.id !== 'number') continue;
        const optLabel = opt.title?.translated;
        if (optLabel) optionLabels.set(`${f.id}:${feat.id}:${opt.id}`, optLabel);
      }
    }
  }

  return { filterLabels, featureLabels, optionLabels, rawFilters: filters };
}

const REGISTRY = new Map<number, TaxonomyIndex>([
  [1406, buildIndex(taxonomy1406Json)],
  [1404, buildIndex(taxonomy1404Json)],
]);

function getIndex(subCategoryId: number): TaxonomyIndex | undefined {
  return REGISTRY.get(subCategoryId);
}

export function getFilterLabel(filterId: number, subCategoryId = 1406): string | null {
  return getIndex(subCategoryId)?.filterLabels.get(filterId) ?? null;
}

export function getFeatureLabel(
  filterId: number,
  featureId: number,
  subCategoryId = 1406,
): string | null {
  return getIndex(subCategoryId)?.featureLabels.get(`${filterId}:${featureId}`) ?? null;
}

export function getOptionLabel(
  filterId: number,
  featureId: number,
  optionId: number,
  subCategoryId = 1406,
): string | null {
  return getIndex(subCategoryId)?.optionLabels.get(`${filterId}:${featureId}:${optionId}`) ?? null;
}

export interface TaxonomyStats {
  filters: number;
  features: number;
  options: number;
}

export function taxonomyStats(): TaxonomyStats {
  const idx = getIndex(1406);
  return {
    filters: idx?.filterLabels.size ?? 0,
    features: idx?.featureLabels.size ?? 0,
    options: idx?.optionLabels.size ?? 0,
  };
}

// ─── Taxonomy response for GET /api/filter/taxonomy ─────────────────────────

export interface TaxonomyFeature {
  featureId: number;
  label: string;
  unit?: string;
  units?: string[];
  options?: Array<{ id: number; label: string }>;
}

export interface TaxonomyFilter {
  filterId: number;
  label: string;
  kind: 'options' | 'range' | 'boolean';
  features: TaxonomyFeature[];
}

const FILTER_KIND_MAP: Record<string, TaxonomyFilter['kind']> = {
  FILTER_TYPE_OPTIONS: 'options',
  FILTER_TYPE_RANGE: 'range',
  FILTER_TYPE_FEATURES_AND: 'boolean',
};

export function buildTaxonomyResponse(subCategoryId: number): TaxonomyFilter[] {
  const idx = getIndex(subCategoryId);
  if (!idx) return [];

  const result: TaxonomyFilter[] = [];

  for (const f of idx.rawFilters) {
    if (typeof f.id !== 'number') continue;
    const kind = FILTER_KIND_MAP[f.type ?? ''];
    if (!kind) continue;

    const label = f.title?.translated ?? String(f.id);
    const filterUnits = f.units ?? [];

    const features: TaxonomyFeature[] = (f.features ?? []).map((feat) => {
      const featureLabel = feat.title?.translated ?? String(feat.id);

      if (kind === 'options') {
        const options = (feat.options ?? []).map((opt) => ({
          id: opt.id,
          label: opt.title?.translated ?? String(opt.id),
        }));
        return { featureId: feat.id, label: featureLabel, options };
      }

      if (kind === 'range') {
        const firstUnit = filterUnits[0];
        if (filterUnits.length === 1 && firstUnit !== undefined) {
          return { featureId: feat.id, label: featureLabel, unit: firstUnit };
        }
        if (filterUnits.length > 1) {
          return { featureId: feat.id, label: featureLabel, units: [...filterUnits] };
        }
        return { featureId: feat.id, label: featureLabel };
      }

      // boolean
      return { featureId: feat.id, label: featureLabel };
    });

    result.push({ filterId: f.id, label, kind, features });
  }

  return result;
}

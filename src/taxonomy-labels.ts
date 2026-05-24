// Human-readable labels for 999.md filter triples (filterId, featureId,
// optionId). Loaded once at module load from the captured filter-taxonomy
// response in src/data/. The /api/filters route enriches its FilterGroup
// payload with these so the operator UI can render "Vând" instead of "776".
//
// This is a static distillation: 999.md's taxonomy doesn't change often,
// and re-capturing it (scripts/capture-session.ts → src/data/filter-taxonomy.json)
// is the supported refresh path.

import taxonomyJson from './data/filter-taxonomy.json' with { type: 'json' };

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

const filterLabels = new Map<number, string>();
const featureLabels = new Map<string, string>(); // key: `${filterId}:${featureId}`
const optionLabels = new Map<string, string>(); // key: `${filterId}:${featureId}:${optionId}`

function ingest(): void {
  const root = taxonomyJson as RawTaxonomy;
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
}

ingest();

export function getFilterLabel(filterId: number): string | null {
  return filterLabels.get(filterId) ?? null;
}

export function getFeatureLabel(filterId: number, featureId: number): string | null {
  return featureLabels.get(`${filterId}:${featureId}`) ?? null;
}

export function getOptionLabel(
  filterId: number,
  featureId: number,
  optionId: number,
): string | null {
  return optionLabels.get(`${filterId}:${featureId}:${optionId}`) ?? null;
}

export interface TaxonomyStats {
  filters: number;
  features: number;
  options: number;
}

export function taxonomyStats(): TaxonomyStats {
  return {
    filters: filterLabels.size,
    features: featureLabels.size,
    options: optionLabels.size,
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

export function buildTaxonomyResponse(): TaxonomyFilter[] {
  const root = taxonomyJson as RawTaxonomy;
  const rawFilters = root.data?.category?.filters ?? [];
  const result: TaxonomyFilter[] = [];

  for (const f of rawFilters) {
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

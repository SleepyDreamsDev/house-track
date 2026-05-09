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
  title?: RawTitle;
  options?: RawOption[];
}

interface RawFilter {
  id: number;
  title?: RawTitle;
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

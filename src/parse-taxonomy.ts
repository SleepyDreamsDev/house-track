// Filter taxonomy resolver.
//
// 999.md groups features under filters: filterId is the parent group;
// featureId is the leaf filter. The crawler observes (featureId, optionId)
// directly on each FeatureValue but has to resolve filterId from a separate
// taxonomy.
//
// Two LUT sources:
//   - bootstrapLutFromConfig() — derives anchors from src/config.ts. Stale:
//     999.md's redesign (2026-05-09 capture) showed offer-type now uses
//     filterId 16 and region uses 32, vs config.ts's 41 and 40. Bootstrap
//     is preserved as a fallback only.
//   - parseTaxonomyResponse(json) — walks a captured filter-taxonomy
//     response. Authoritative once the fixture is available at
//     src/data/filter-taxonomy.json.
//
// Use mergeLuts(bootstrap, captured) — captured wins on conflict.

import { FILTER } from './config.js';

// featureId → filterId. Many featureIds may share a filterId (e.g. several
// area features under filterId "Property facts").
export type TaxonomyLut = ReadonlyMap<number, number>;

// Build the LUT from FILTER.searchInput.filters. Every (filterId, featureId)
// pair the search query already references gets seeded. Safe to call repeatedly.
export function bootstrapLutFromConfig(): TaxonomyLut {
  const out = new Map<number, number>();
  for (const filter of FILTER.searchInput.filters) {
    for (const feature of filter.features) {
      out.set(feature.featureId, filter.filterId);
    }
  }
  return out;
}

// Best-effort parse of a captured filter-taxonomy GraphQL response. The shape
// is unknown until the live capture lands; this walks any object/array tree
// and emits (filterId, featureId) edges from any node that has a numeric
// `filterId` field with a nested `features[].featureId` (or `features[].id`)
// structure. When the real fixture lands, tighten the shape parser here.
export function parseTaxonomyResponse(json: unknown): TaxonomyLut {
  const out = new Map<number, number>();
  walk(json, out);
  return out;
}

function walk(node: unknown, out: Map<number, number>): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  const filterId = pickNumber(obj, ['filterId', 'id']);
  const features = obj['features'];
  if (filterId !== null && Array.isArray(features)) {
    for (const f of features) {
      if (f && typeof f === 'object') {
        const fid = pickNumber(f as Record<string, unknown>, ['featureId', 'id']);
        if (fid !== null) out.set(fid, filterId);
      }
    }
  }

  for (const value of Object.values(obj)) walk(value, out);
}

function pickNumber(obj: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

// Merge two LUTs. Right side wins on conflicts so a captured taxonomy can
// override the bootstrap (which uses only known anchors).
export function mergeLuts(a: TaxonomyLut, b: TaxonomyLut): TaxonomyLut {
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, v);
  return out;
}

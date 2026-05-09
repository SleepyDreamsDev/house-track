// 999.md adapter — translates GenericFilter into the GraphQL searchInput
// shape that lives in src/config.ts FILTER.searchInput.
//
// Param IDs were captured from a real browser session per CLAUDE.md.
// Each unmapped value at runtime throws UnknownGenericFilterValueError
// rather than silently dropping — see src/types/filter.ts module header.

import type { Category, GenericFilter, Locality, TransactionType } from '../types/filter.js';
import type { ResolvedFilter, Source } from './types.js';
import { UnknownGenericFilterValueError } from './types.js';

interface FilterTriple {
  filterId: number;
  featureId: number;
  optionId: number;
}

const TRANSACTION_TYPE_MAP: Record<TransactionType, FilterTriple> = {
  sale: { filterId: 16, featureId: 1, optionId: 776 },
  rent: { filterId: 16, featureId: 1, optionId: 903 },
};

const LOCALITY_MAP: Record<Locality, FilterTriple> = {
  chisinau: { filterId: 32, featureId: 7, optionId: 12900 },
  // Sub-localities below Chișinău municipality. Until verified against a
  // real captured request these reuse the municipality-level optionId so
  // resolve() always succeeds; the post-filter narrows by district name.
  durlesti: { filterId: 32, featureId: 7, optionId: 12900 },
  codru: { filterId: 32, featureId: 7, optionId: 12900 },
  colonita: { filterId: 32, featureId: 7, optionId: 12900 },
};

const CATEGORY_SUBCATEGORY_MAP: Record<Category, number> = {
  house: 1406,
  apartment: 1404,
};

function groupFiltersByFilterId(
  triples: ReadonlyArray<FilterTriple>,
): ResolvedFilter['searchInput']['filters'] {
  const byFilterId = new Map<number, Map<number, number[]>>();
  for (const t of triples) {
    let byFeatureId = byFilterId.get(t.filterId);
    if (!byFeatureId) {
      byFeatureId = new Map();
      byFilterId.set(t.filterId, byFeatureId);
    }
    let optionIds = byFeatureId.get(t.featureId);
    if (!optionIds) {
      optionIds = [];
      byFeatureId.set(t.featureId, optionIds);
    }
    if (!optionIds.includes(t.optionId)) {
      optionIds.push(t.optionId);
    }
  }
  const result: Array<{
    filterId: number;
    features: Array<{ featureId: number; optionIds: number[] }>;
  }> = [];
  for (const [filterId, byFeatureId] of byFilterId) {
    const features: Array<{ featureId: number; optionIds: number[] }> = [];
    for (const [featureId, optionIds] of byFeatureId) {
      features.push({ featureId, optionIds });
    }
    result.push({ filterId, features });
  }
  return result;
}

function resolve(generic: GenericFilter): ResolvedFilter {
  const subCategoryId = CATEGORY_SUBCATEGORY_MAP[generic.category];
  if (subCategoryId === undefined) {
    throw new UnknownGenericFilterValueError('category', generic.category);
  }

  const triples: FilterTriple[] = [];

  const txn = TRANSACTION_TYPE_MAP[generic.transactionType];
  if (!txn) {
    throw new UnknownGenericFilterValueError('transactionType', generic.transactionType);
  }
  triples.push(txn);

  for (const loc of generic.locality) {
    const mapped = LOCALITY_MAP[loc];
    if (!mapped) {
      throw new UnknownGenericFilterValueError('locality', loc);
    }
    triples.push(mapped);
  }

  const postFilter: ResolvedFilter['postFilter'] = {
    maxPriceEur: generic.priceMax ?? Number.MAX_SAFE_INTEGER,
    maxAreaSqm: generic.sqmMax ?? Number.MAX_SAFE_INTEGER,
  };

  return {
    searchInput: {
      subCategoryId,
      source: 'AD_SOURCE_DESKTOP',
      filters: groupFiltersByFilterId(triples),
    },
    postFilter,
  };
}

export const source999md: Source = {
  slug: '999md',
  name: '999.md',
  resolve,
};

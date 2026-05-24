# Category-aware filter taxonomy (sub-project D)

**Date:** 2026-05-24
**Status:** spec — pending implementation
**Follows:** the merged filter-parity work (#73). Closes the apartment gap it left.

## Problem

`src/data/filter-taxonomy.json` is a **houses-only** capture (subCategoryId
1406 — it carries `Stare casă`, `Suprafață teren`, `Niveluri`, `Suprafață
mansardă`). `taxonomy-labels.ts` static-imports that one file, and
`GET /api/filter/taxonomy` serves it **regardless of `category`**. So selecting
**apartment** (subCategoryId 1404) in the Filter UI shows house filters (land
area, attic…) and omits apartment-specific ones — wrong dimensions, wrong
labels, and the resolver validates apartment selections against the houses
tree.

## Goal

Make the whole filter stack category-aware: capture the apartment taxonomy,
store per-subcategory, and key the loader / API / resolver / UI on the selected
category.

## Decisions

- **Per-subcategory taxonomy files.** Rename the current capture to
  `src/data/filter-taxonomy.1406.json` (houses) and add
  `filter-taxonomy.1404.json` (apartments). A small loader maps
  `subCategoryId → taxonomy`. (`CATEGORY_SUBCATEGORY_MAP` already gives house→1406,
  apartment→1404.)
- **Capture via the human-like path only.** Per the standing rule
  ([[feedback_999md_human_like_requests]]), capture with Playwright Firefox +
  seeded `cf_clearance` cookies — never the undici crawler. Navigate to the
  apartments category listings page and capture the taxonomy GraphQL op
  (`GetFilters`/`category`) for 1404. The exact apartments listing URL is a
  capture-time detail (houses uses `/ro/list/real-estate/house-and-garden`).
- **API param.** `GET /api/filter/taxonomy?category=house|apartment` (default:
  the active filter's `category`). UI re-fetches on category change.
- **Selection reconciliation.** On category switch, drop any `FilterSelection`
  whose `filterId/featureId` isn't in the new category's taxonomy (apartment
  and house trees differ); keep the universal ones (offer-type 16, region 32,
  price 9441). Surface a small "N filters not available for apartments" notice.

## Changes

### Capture
- Use `pnpm capture-filters` / `capture-session` against the apartments page;
  write `src/data/filter-taxonomy.1404.json`. Document the apartments URL in
  `docs/captured-filter-serialization.md`.

### `src/taxonomy-labels.ts`
- Replace the single static import with a `subCategoryId → taxonomy` registry
  (static-import both JSONs). `getFilterLabel`, `getFeatureLabel`,
  `getOptionLabel`, `buildTaxonomyResponse` gain a `subCategoryId` parameter.
  No behavior change for callers that pass 1406.

### Resolver `src/sources/999md.ts`
- Validate each selection against the taxonomy for the filter's category
  (`CATEGORY_SUBCATEGORY_MAP[generic.category]`), not a global tree.
  `UnknownGenericFilterValueError` still on miss.

### API `src/web/routes/filter.ts`
- `GET /api/filter/taxonomy?category=` → `buildTaxonomyResponse(subCategoryId)`.
  Reject an unknown category with 400. `/api/filters` (observed facets)
  unaffected.

### UI `web/src/pages/Filter.tsx` + `components/filters/`
- Taxonomy query keyed on the draft's `category`
  (`useQuery(['filter-taxonomy', category])`). On category change, refetch and
  reconcile `draft.filters` (drop now-invalid selections) + show the notice.

## Testing

- **Loader** (unit): `buildTaxonomyResponse(1404)` returns apartment dims (no
  `Suprafață teren`/`Stare casă`); 1406 unchanged; unknown id → empty/throws.
- **Resolver** (unit): an apartment-only selection validates under category
  apartment and is rejected under house, and vice-versa.
- **API** (integration): `?category=apartment` differs from `?category=house`;
  unknown category → 400.
- **UI** (RTL): switching category refetches the taxonomy and drops invalid
  selections, keeping offer-type/region/price; notice renders.
- Fixtures from the captured 1404 JSON; no live 999.md in tests.

## Non-goals

- No new filter *kinds* (reuses options/range/boolean from #73).
- No commune/sector cascade, no price-at-source (separate capture-gated items).
- Rent vs sale stays an offer-type selection (filter 16), not a subcategory.

## Risk

- **Apartment capture fidelity**: the taxonomy op must be captured cleanly for
  1404 (same op as houses). If the apartments page structure differs, fall back
  to the `--taxonomy-op=<Name>` flag the capture script already supports.

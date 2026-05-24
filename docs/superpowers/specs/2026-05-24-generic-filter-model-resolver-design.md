# Generic filter model + resolver + API (sub-project B)

**Date:** 2026-05-24
**Status:** spec — pending implementation
**Parent goal:** Full 999.md filter parity, source-level (A → **B** → C).
**Depends on:** [sub-project A](2026-05-24-capture-range-boolean-serialization-design.md)
— serialization contract in [`docs/captured-filter-serialization.md`](../../captured-filter-serialization.md)
and [`src/__tests__/fixtures/filter-serialization.json`](../../../src/__tests__/fixtures/filter-serialization.json).

## Why

The operator filter exposes 6 narrow fields; 999.md exposes ~25 dimensions of
four types. A captured how all four serialize into `Ads_SearchInput.filters`.
B replaces the narrow model with a **taxonomy-driven generic model** and
generalizes the 999.md adapter to emit every type at source level — and fixes
two latent gaps along the way.

## Decisions (locked)

- **Fully-generic model.** `GenericFilter = { category, filters: FilterSelection[] }`.
  `transactionType` and region stop being typed fields — they become ordinary
  selections (filters 16 and 32). Only `category` stays well-known because it
  maps to the GraphQL `subCategoryId`, not to a filter.
- **Price via postFilter.** Area + all other ranges resolve at the source
  (captured shapes). Price (filter 9441) was not captured and is
  currency-sensitive, so it stays the EUR-normalized client-side postFilter —
  which is also where the priceMin gap gets fixed.
- **Locality is two-tier.** Region filter 32 exposes only raion-level options
  statically (feature 7, 44 raions); commune/sector cascade in (features 8/9,
  empty in the capture). So raion → source-level; commune/sector (Durlești,
  Codru, Colonița, Chișinău sectors) stay post-filter on parsed `district`/
  `sector`. This retires the fake-optionId hack.

## Data model

### `src/types/filter.ts` (+ mirror `web/src/lib/filterSchema.ts`)

```ts
type FilterSelection =
  | { kind: 'options'; filterId: number; featureId: number; optionIds: number[] }   // ≥1 id
  | { kind: 'range';   filterId: number; featureId: number; unit?: string; min?: string; max?: string }
  | { kind: 'boolean'; filterId: number; featureId: number };

interface GenericFilter {
  category: 'house' | 'apartment';   // → subCategoryId
  filters: FilterSelection[];
}
```

- Zod: discriminated union on `kind`. `options.optionIds` min 1; `range`
  requires at least one of min/max, min ≤ max when both present; values are
  **strings** (mirror 999's wire format). No empty/duplicate selections.
- `defaultGenericFilter`: `category:'house'`, `filters:` offer-type sale
  (`{kind:'options',filterId:16,featureId:1,optionIds:[776]}`), region Chișinău
  mun. (`{kind:'options',filterId:32,featureId:7,optionIds:[12900]}`), price max
  (`{kind:'range',filterId:9441,featureId:2,unit:'UNIT_EUR',max:'250000'}`). Price
  filter 9441 is `FEATURE_PRICE` with currency units `[EUR, USD, MDL]` — its
  per-currency nature is exactly why it stays the EUR-normalized postFilter.
- **Structural validation only** in zod. Whether each `filterId/featureId/
  optionId/unit` actually exists is validated by the resolver against the
  taxonomy (keeps the existing `UnknownGenericFilterValueError` 400 path).

### `src/sources/types.ts` — `ResolvedSearchInput.filters[].features[]`

Widen the feature shape to the captured union:

```ts
feature = { featureId: number }                                   // boolean (bare)
        | { featureId: number; optionIds: number[] }              // options
        | { featureId: number; unit?: string; range: { min?: string; max?: string } }; // range
```

Same change mirrored in `src/graphql.ts` `SearchInputOverride`. `source` type
widens to include `AD_SOURCE_DESKTOP_REDESIGN` (see config below).

## Resolver — `src/sources/999md.ts`

`resolve(generic)`:

1. `subCategoryId` ← `CATEGORY_SUBCATEGORY_MAP[generic.category]` (house 1406,
   apartment 1404); throw `UnknownGenericFilterValueError('category', …)` if absent.
2. For each `FilterSelection`, validate `filterId/featureId` (and `optionIds`/
   `unit`) against the loaded taxonomy; throw `UnknownGenericFilterValueError`
   with the offending field on miss. Then translate by kind into the captured
   feature shape:
   - `options` → `{featureId, optionIds}`
   - `range` (except price 9441) → `{featureId, [unit], range:{min,max}}`
   - `boolean` → `{featureId}`
3. **Price special-case:** a `range` selection with `filterId === 9441` does
   NOT go into `searchInput`; its min/max populate `postFilter`
   (EUR-normalized). All non-price selections AND-merge into `searchInput.filters`
   via the existing `groupFiltersByFilterId` (extended to merge range/boolean,
   not just optionIds).
4. `postFilter`: `{ minPriceEur, maxPriceEur }` from the price selection
   (sentinels `0` / `Number.MAX_SAFE_INTEGER` when unset). **Area drops out of
   postFilter** — it is now enforced at the source.

`applyPostFilter` (caller in `src/web/routes/sweeps.ts` / `src/sweep.ts`) gains
a `minPriceEur` floor; the `maxAreaSqm` cap is removed (area is source-side).

## Config — `src/config.ts`

- `searchInput.source` → `AD_SOURCE_DESKTOP_REDESIGN` (A found the live value;
  verify the endpoint still accepts the old one — if both work, switch to the
  observed value for fidelity).
- Add `sort: 'SORT_ADS_DATE_DESC'` to the built search variables (A observed it
  on every real request; `buildSearchVariables` should include it).
- `FILTER.searchInput.filters` / `postFilter` constants re-expressed in the new
  default shape so `filter-resolver.ts` fallback still deep-equals a real query.

## Persistence & fallback — `src/filter-resolver.ts`

No migration: an old-shape persisted `filter.generic` fails the new
`genericFilterSchema`, so `resolveActiveFilter()` falls back to
`defaultGenericFilter` (existing behavior). The operator re-saves once under the
new form. `fallback()` rebuilds from the new-shape `FILTER` constant.

## HTTP API

- `GET` / `PUT /api/filter` — unchanged response envelope
  `{ generic, sources, resolved:{searchInput, postFilter}, sourceSlug }`; only
  the `generic` and `resolved.searchInput` shapes change per above. PUT still
  returns 400 with `details[{path,message}]` on zod failure and on
  `UnknownGenericFilterValueError`.
- **New `GET /api/filter/taxonomy`** — the C contract. Serves the full filter
  schema from `filter-taxonomy.json` + `taxonomy-labels.ts` so the UI can render
  every dimension without a prior sweep:

  ```jsonc
  [{
    "filterId": 1073,
    "label": "Suprafață totală",
    "kind": "range",            // 'options' | 'range' | 'boolean'
    "features": [{ "featureId": 244, "label": "Suprafață totală",
                   "unit": "UNIT_METER_SQUARE",
                   "options": [] }]          // options: [{id,label}] for OPTIONS
  }, …]
  ```

  `kind` derived from taxonomy `type` (`FILTER_TYPE_OPTIONS`→options,
  `FILTER_TYPE_RANGE`→range, `FILTER_TYPE_FEATURES_AND`→boolean). Multi-feature
  filters (region 32, amenities 4132) list all features.

## Testing (Testing-Trophy order; fixtures, no live 999.md)

- **Resolver** (unit, highest value): each kind → captured feature shape; deep-
  equals `fixtures/filter-serialization.json`; price routes to postFilter;
  unknown filterId/featureId/optionId/unit → `UnknownGenericFilterValueError`
  with correct field; multi-selection AND-merge; default resolves to a valid
  searchInput.
- **Schema** (unit): discriminated union accept/reject; range min≤max; options
  min-1; price min≤max gap fixed.
- **API** (integration): GET shape; PUT persist→GET round-trip; PUT 400 paths;
  `GET /api/filter/taxonomy` returns all dimensions with correct `kind`/labels;
  Postgres via testcontainers per existing pattern.
- Seed any Listing/Snapshot test rows mirroring `persist.ts`.

## Non-goals

- No UI (sub-project C consumes `/api/filter` + `/api/filter/taxonomy`).
- No price-range source serialization (price stays postFilter).
- No commune/sector cascade capture (sector stays post-filter via existing work).
- No Setting data migration (fallback-to-default covers it).

## Open risks

- **`source` enum**: if `AD_SOURCE_DESKTOP_REDESIGN` is rejected by the endpoint
  for the crawler's header profile, keep `AD_SOURCE_DESKTOP`; document which the
  live endpoint accepts.
- **Price (9441/feature 2)**: confirmed `FEATURE_PRICE`, units `[EUR,USD,MDL]`.
  Resolver routes it to postFilter; never emit it into `searchInput`.

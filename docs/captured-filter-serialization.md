# Captured 999.md filter serialization (RANGE + BOOLEAN)

> Sub-project A deliverable — see
> [`docs/superpowers/specs/2026-05-24-capture-range-boolean-serialization-design.md`](superpowers/specs/2026-05-24-capture-range-boolean-serialization-design.md).
> Captured **2026-05-24** from a real headed Firefox session against 999.md via
> `scripts/capture-filter-serialization.ts`. Golden reference:
> [`src/__tests__/fixtures/filter-serialization.json`](../src/__tests__/fixtures/filter-serialization.json).

This documents how 999.md's `Ads_SearchInput.filters` encodes every filter
type, so the source adapter (`src/sources/999md.ts`, sub-project B) can emit
all of them at source level instead of post-filtering. **CLAUDE.md forbids
guessing param shapes — these were observed, not invented.**

## The request envelope

Baseline (no filters) and a real paginated request:

```json
{
  "source": "AD_SOURCE_DESKTOP_REDESIGN",
  "sort": "SORT_ADS_DATE_DESC",
  "subCategoryId": 1406,
  "filters": [],
  "pagination": { "limit": 78, "skip": 0 }
}
```

All filters live in the `filters` array. Each entry shares one envelope —
`{ filterId, features: [...] }` — and the **feature object's extra keys** are
what distinguishes the four types below. `filterId` / `featureId` / `optionId`
/ `unit` values all come from `src/data/filter-taxonomy.json`.

## Per-type serialization

### 1. OPTIONS (`FILTER_TYPE_OPTIONS`) — *already emitted today*

Multi-select. Feature carries `optionIds` (OR within the array).

```json
{ "filterId": 1193, "features": [{ "featureId": 247, "optionIds": [897] }] }
```

### 2. RANGE, plain int (`FILTER_TYPE_RANGE` / `FEATURE_INT`)

e.g. **rooms** (filter 1201, feature 588). Feature carries `range` with
**string** `min` / `max`. The two bounds are independent — 999.md sends
`{min}` alone until a `max` is entered, then `{min, max}`.

```json
{ "filterId": 1201, "features": [{ "featureId": 588, "range": { "min": "2", "max": "4" } }] }
```

### 3. RANGE, unit-typed (`FILTER_TYPE_RANGE` / `FEATURE_INT_UNIT`)

e.g. **total area** (filter 1073, feature 244). Same as above plus a `unit`
field taken from the taxonomy filter's `units[]` (here `UNIT_METER_SQUARE`).

```json
{
  "filterId": 1073,
  "features": [
    { "featureId": 244, "unit": "UNIT_METER_SQUARE", "range": { "min": "50", "max": "200" } }
  ]
}
```

### 4. BOOLEAN amenity (`FILTER_TYPE_FEATURES_AND` / `FEATURE_BOOLEAN`)

e.g. **"Gata de mutat"** (filter 4132, feature 171). The feature is **bare** —
just `featureId`, no `optionIds`/`range`. Its presence means the flag is ON.
Multiple amenities are AND-ed (each its own feature under filterId 4132).

```json
{ "filterId": 4132, "features": [{ "featureId": 171 }] }
```

## Side findings (config drift — feed into sub-project B)

1. **`source` enum changed.** The redesigned site sends
   `AD_SOURCE_DESKTOP_REDESIGN`; `src/config.ts` still has `AD_SOURCE_DESKTOP`.
   Verify which the GraphQL endpoint currently accepts before B ships.
2. **`sort` field.** Real requests include `sort: "SORT_ADS_DATE_DESC"`; the
   current builder omits it. Harmless default, but worth adding for parity.
3. **Filters auto-apply.** 999.md re-queries on every sidebar change (live
   result count) — there is no "apply" submit to model.

## Capture method (for re-runs)

`pnpm tsx scripts/capture-filter-serialization.ts [--dwell <ms>] [--headless]`

Drives Firefox (POLITENESS UA + bootstrap cookies), dismisses the intro.js
tour, locates each filter `<details>` by its title, fills ranges / toggles
amenities, and diffs each resulting `SearchAds` against the unfiltered
baseline. RANGE `<details>` have no numeric `id` (only OPTIONS do) — locate by
title text. `--dwell` keeps the window open for manual-assist if a selector
drifts.

## Status

RANGE-int, RANGE-unit, and BOOLEAN serialization **captured and confirmed**.
Sub-project A complete; the contract above unblocks sub-project B (generic
filter model + resolver emitting all four types at source level).

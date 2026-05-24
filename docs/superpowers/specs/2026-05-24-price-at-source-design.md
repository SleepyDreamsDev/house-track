# Price at source + currency picker (sub-project E)

**Date:** 2026-05-24
**Status:** spec — pending implementation
**Follows:** #73 (filter parity) + #75 (category-aware). Capture confirmed in
`docs/captured-filter-serialization.md` + `fixtures/filter-serialization.json`.

## Problem

#73 deliberately kept **price** as an EUR-normalized client-side `postFilter`
because the price-range serialization hadn't been captured. It now has
(2026-05-24): price (`FILTER_TYPE_RANGE` / `FEATURE_PRICE`, filter 9441 /
feature 2) serializes exactly like a unit-range, with the **currency as the
`unit`** (`UNIT_EUR | UNIT_USD | UNIT_MDL`):

```json
{ "filterId": 9441, "features": [{ "featureId": 2, "unit": "UNIT_EUR", "range": { "min": "50000", "max": "180000" } }] }
```

So price can filter at the source like every other dimension, and the operator
can pick a currency. After this, **`postFilter` has nothing left to do** (#73
already moved area to the source; price was the only remaining cap).

## Goal

Filter price at the source with a currency picker, and remove the now-vestigial
`postFilter` mechanism entirely.

## Decisions

- **Price → source range.** The resolver stops special-casing filter 9441 into
  `postFilter`; it emits price as an ordinary source range with its `unit`
  (currency), exactly like area. `priceMin` is therefore enforced at the source
  (the #73 min-bound fix is preserved, now source-side).
- **Remove `postFilter`.** It held only price; with price source-side it is
  dead. Drop it from `ResolvedFilter`, the resolver, `config.ts`,
  `filter-resolver.ts`, the `/api/filter` response, and the sweep
  (`applyPostFilter` + `PostFilter` in `parse-index.ts`, the deps/call in
  `sweep.ts`, and the wiring in `index.ts` + `web/routes/sweeps.ts`). The sweep
  now persists exactly what the source-filtered index returns.
- **Currency / unit picker (UI).** `RangeField` renders a `<select>` of units
  when the taxonomy feature exposes `units[]` (price → EUR/USD/MDL; land area
  1200 → its units). Default `units[0]` (EUR for price). The chosen unit is
  stored on the `range` selection. This supersedes #73's "pin to base unit, no
  picker" for multi-unit ranges. Single-`unit` ranges (e.g. total area m²) keep
  the static suffix.

## Changes

### Backend (`src/`)
- `src/sources/999md.ts`: delete the 9441→postFilter branch; price selection
  flows through the normal range path into `searchInput.filters`. Validate the
  `unit` against feature 2's `units[]` in the taxonomy.
- `src/sources/types.ts`: remove `postFilter` from `ResolvedFilter`.
- `src/parse-index.ts`: remove `PostFilter` + `applyPostFilter`.
- `src/sweep.ts`: remove the `applyPostFilter`/`postFilter` deps and the call;
  persist `allStubs` directly.
- `src/index.ts`, `src/web/routes/sweeps.ts`: remove the `applyPostFilter`
  wiring.
- `src/config.ts`, `src/filter-resolver.ts`: drop `postFilter`; the default
  filter already carries a price range (`9441/feat2/UNIT_EUR/max 250000`) so the
  fallback still resolves to a real source query.
- `src/web/routes/filter.ts`: `resolved` no longer includes `postFilter`.

### Frontend (`web/`)
- `RangeField`: accept `units?: string[]` + current `unit` + `onChangeUnit`;
  render a unit `<select>` when `units.length > 1`, else the static suffix.
- `FilterForm`: pass `units`, track the chosen unit in the range selection
  (default `units[0]`), thread `onChangeUnit` → updates the selection's `unit`.
- The "Resolved" panel just stringifies `resolved`; dropping `postFilter` is
  cosmetic there.

## Testing
- **Resolver** (unit): price selection → `searchInput.filters` entry
  `{9441,[{featureId:2,unit,range}]}` (deep-equals `fixtures.price`); no
  `postFilter` on the result; a USD unit validates, an unknown unit → 400.
- **Sweep** (integration): persists source-filtered stubs with no client cap;
  no `applyPostFilter` path remains.
- **API**: `/api/filter` `resolved` has `searchInput` only; default resolves
  with price in `filters`.
- **UI** (RTL): a `units[]` range renders a currency select defaulting to EUR;
  changing it updates the selection's `unit`; the PUT body carries it.
- Update all tests that referenced `postFilter`/`applyPostFilter`.

## Risk
- **No client-side price net.** The sweep now trusts the source price filter
  (validated live — 999 accepts the `unit`-range). 999 converts to the selected
  currency; our parsed `priceEur` is used only for analytics/display, so minor
  conversion-rounding differences at the bound are immaterial.
- **Currency vs EUR view.** Selecting USD/MDL filters the *sweep* in that
  currency; analytics remain EUR-normalized. Acceptable and explicit to the
  operator via the picker.

## Non-goals
- No re-introduction of any client-side filtering.
- No analytics/normalization changes (priceEur stays the display/analytics basis).

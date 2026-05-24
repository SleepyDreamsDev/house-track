# Filter UI parity (sub-project C)

**Date:** 2026-05-24
**Status:** spec — pending implementation
**Parent goal:** Full 999.md filter parity, source-level (A → B → **C**).
**Depends on:** [sub-project B](2026-05-24-generic-filter-model-resolver-design.md)
contract — the `FilterSelection` model, `GET/PUT /api/filter`, and the new
`GET /api/filter/taxonomy` endpoint.

## Why

`web/src/pages/Filter.tsx` hardcodes 6 fields plus an "observed facets" section
that is empty until a sweep runs. With B serving the full taxonomy, the UI can
render **every 999.md dimension** by type, configurable before any sweep —
mirroring 999.md's own sidebar.

## Scope

Rebuild the **Generic filter** + **Source filters** sections of `Filter.tsx`
into one taxonomy-driven form. Keep the page's **Source** and **Resolved**
sections as-is. Update `web/src/lib/filterSchema.ts` to mirror B's new
`GenericFilter`/`FilterSelection` (the two files stay byte-equivalent in shape).

## Data flow

- `useQuery(['filter'])` → `GET /api/filter` (current `generic`, `sources`,
  `resolved`).
- `useQuery(['filter-taxonomy'])` → `GET /api/filter/taxonomy` (all dimensions:
  `{filterId, label, kind, features:[{featureId, label, unit?, options?:[{id,label}]}]}`).
- Draft = `FilterSelection[]` (+ `category`). Edits mutate the draft; `dirty`
  diff vs persisted; `PUT /api/filter` on Save; 400 `details` surface inline
  (reuse existing error banner).

## Rendering (one section per taxonomy filter, like 999's `<details>`)

Each dimension renders a collapsible group (default collapsed unless it has a
selection), titled by `label`, with a selected-count badge — by `kind`:

- **options** → multi-select chips per option (`optionIds` OR-within). Long
  lists (region 44, developer 93, amenities-as-options) get a client-side
  search box. Reuse the existing chip styling from the current facets section.
- **range** → `min`/`max` number inputs with the unit suffix (e.g. "m²"); writes
  string bounds; client-side min≤max hint.
- **boolean** → toggle chip per feature (amenities filter 4132 → 37 toggles;
  AND-ed).

`category` (house/apartment) stays a top-level select (drives `subCategoryId`).

## Keep / drop

- **Keep** the Resolved panel (`JSON.stringify(resolved)`), Save/Reset, the
  dirty/"next sweep will use this" affordance, and the section nav.
- **Drop** the hardcoded transaction/locality/price/sqm fields — they are now
  taxonomy selections (offer-type 16, region 32, price 9441, area 1073).
- **Observed facets** (`GET /api/filters`): optional enhancement — overlay each
  option chip with its observed listing count when available; never required
  for the form to render. (Drop the standalone facets section.)

## Components

- New `web/src/components/filters/` — `FilterForm.tsx` (orchestrates draft +
  taxonomy), `OptionsField.tsx`, `RangeField.tsx`, `BooleanField.tsx`,
  `FilterSection.tsx` (collapsible). Keeps `Filter.tsx` thin.
- Reuse `Card`, `PageHeader`/`SectionHeader`, `Button`, `Input` from `ui/`.

## Testing (Vitest + RTL; behavior not implementation)

- Renders a group per taxonomy dimension with the right control for its `kind`.
- Toggling an option / filling a range / toggling a boolean updates the draft
  to the correct `FilterSelection` shape (assert the PUT body via mocked fetch).
- Save posts `{ generic: { category, filters } }`; 400 `details` render inline.
- Long option list search filters chips.
- Empty/loading states (taxonomy not yet loaded).
- Mock `/api/filter` + `/api/filter/taxonomy`; no real backend.

## Non-goals

- No backend changes (consumes B's endpoints).
- No commune/sector UI beyond the region raion options B exposes.
- No persistence of UI collapse state.

## Contract risk

`filterSchema.ts` must match B's `types/filter.ts` shape exactly (they are a
documented mirror). Both sub-projects implement the same `FilterSelection`
union from B's spec; integration step runs `pnpm typecheck` across both to
catch drift.

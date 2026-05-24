# Capture RANGE + BOOLEAN filter serialization (sub-project A)

**Date:** 2026-05-24
**Status:** spec — pending capture
**Parent goal:** Full 999.md filter parity, source-level (sub-projects A → B → C).

## Why this exists

The Filter page currently exposes 6 fields. 999.md's own sidebar exposes ~25
dimensions (see `src/data/filter-taxonomy.json`), of three types:

| Taxonomy type         | Examples                                   | Source-query shape |
| --------------------- | ------------------------------------------ | ------------------ |
| `FILTER_TYPE_OPTIONS` | building type, condition, levels, region   | **Known** — `{filterId, features:[{featureId, optionIds}]}`, already emitted |
| `FILTER_TYPE_RANGE`   | rooms, total/living/kitchen/land area, …   | **Unknown** — never captured |
| `FILTER_TYPE_FEATURES_AND` | 37 boolean amenities                  | **Unknown** — never captured |

CLAUDE.md forbids guessing 999.md param shapes ("Always copy from a real
browser session — never guess"). So before the resolver (sub-project B) can
emit RANGE/BOOLEAN filters at the source, we must **observe** how 999.md
serializes them into the live `SearchAds` GraphQL request.

This sub-project is a **discovery spike**. Its only deliverable is the
documented serialization shape (plus fixtures). No schema, resolver, or UI
changes — those are B and C.

## Objective

Capture, from a real Firefox session against 999.md, the exact request shape
for:

1. A RANGE-int filter — **Număr de camere** (rooms; filterId 1201, feature 588), min 2 / max 4.
2. A RANGE-unit filter — **Suprafață totală** (total area; filterId 1073, `UNIT_METER_SQUARE`), min 50 / max 200.
3. A FEATURES_AND boolean — one **Adăugător** amenity (filterId 4132, e.g. feature 171 "Gata de mutat"), toggled on.

For each, record where and how it appears in the request: under
`variables.input.filters`? A different field? The request URL? Are range
bounds nested under the feature as `{min,max}` / `{from,to}` / `valueMin`?
Are booleans an optionId pair, a boolean field, or a feature with no options?

## Approach

Extend the capture flow (new script `scripts/capture-filter-serialization.ts`,
reusing `scripts/lib/capture-utils.ts` helpers). Firefox + `POLITENESS` UA, as
`capture-session.ts` does — never Chromium (anti-bot fingerprint).

1. Launch headed Firefox, navigate homepage → houses listings, capture the
   **baseline** (unfiltered) `SearchAds` request `variables.input`.
2. Apply each target filter in the 999.md sidebar. 999.md re-queries on every
   filter change → capture the `SearchAds` POST that follows each application.
   Auto-apply via taxonomy-title-anchored locators (filter titles are known
   strings, e.g. "Număr de camere"); range filters are min/max text inputs,
   booleans are checkboxes.
3. **Manual-assist fallback:** if a control can't be located, keep headed
   Firefox open for a dwell window and capture every `SearchAds` POST the
   operator triggers by applying filters by hand. Robust to selector drift and
   Cloudflare interstitials.
4. Diff each filtered `input` against the baseline (extend `diffVariables`) to
   isolate the added/changed serialization per filter type. Diff the **whole
   `input` and the URL**, not just `filters` — price/area were historically
   "URL-level params" (config.ts), so ranges may ride the URL, not the
   `filters` array.

## Deliverables

- `docs/captured-filter-serialization.md` — for each of the three types: the
  exact JSON path + shape, field names, unit handling, boolean encoding, and a
  copy-paste example. This is the contract sub-project B builds against.
- `src/__tests__/fixtures/search-ads-range-rooms.json`,
  `…-range-area.json`, `…-boolean-amenity.json` — captured request bodies
  (trimmed like the existing search-ads fixture).
- Unit tests in `scripts/__tests__/` for any new pure helper (diff/extraction)
  — never for the live capture itself.

## Success criteria

- The RANGE-int, RANGE-unit, and BOOLEAN serializations are captured and
  documented unambiguously (a developer can read the doc and emit the same
  request), **or**
- The capture is found infeasible (site blocks automation, shape lives only in
  opaque URL params we can't reconstruct) and that's documented, so the parent
  design falls back to the client-side post-filter tier for those types.

## Non-goals

- No `GenericFilter` schema, resolver, `SearchInputOverride`, or UI changes.
- No automated end-to-end test against the live site.
- No change to the existing `capture-session.ts` happy path.

## Risks

- **Selector drift / Cloudflare challenge** → headed mode + manual-assist
  fallback; never block on a single brittle selector.
- **Ranges may serialize via URL query params**, not the GraphQL `filters`
  array → diff the full request (URL + `variables.input`), not just `filters`.
- **Politeness budget** → applying 3–4 filters is 3–4 extra `SearchAds` POSTs
  in one session; well within budget. No detail fetches needed.

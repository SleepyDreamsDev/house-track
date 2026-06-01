# Specification: Filter & Taxonomy System (999.md Parity)

## Purpose & Scope

The filter and taxonomy system provides a source-agnostic abstraction layer that maps operator-facing UI filters (category, price range, location, area bounds) to source-specific GraphQL/API parameters. It resolves 999.md's opaque property-filter hierarchy (filterId → featureId → optionId) using two-tier lazy-loaded taxonomy files (JSON snapshots of the live category schema), reconciles generic filter selections against the taxonomy via a validation resolver, and surfaces humanized labels for display. The system is non-negotiably honoring 999.md's opaque param ID space — no guessing; all filter IDs are copied from real browser sessions captured via Playwright.

## Architecture & Key Modules

| File Path                | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config.ts`          | Hardcoded defaults: politeness (8s ± 2s gap, Firefox UA), circuit breaker (3 consecutive 4xx → 24h pause), sweep cadence (700 ± 130 listings/tick, quiet hours 02:00–06:00 Europe/Chisinau), and bootstrap filter (subCategoryId 1406 for houses, featureId-based anchors for region + area + price).                                                                                                                                                                                 |
| `src/types/filter.ts`    | TypeScript contract for generic filters: `GenericFilter` (category + array of `FilterSelection`s), discriminated union of three kinds (`options`, `range`, `boolean`), with Zod schemas for validation. Mirrors `web/src/lib/filterSchema.ts`.                                                                                                                                                                                                                                        |
| `src/filter-resolver.ts` | Async entry point: reads `Setting('filter.generic')` from Postgres, validates via `genericFilterSchema`, delegates to the active source's `resolve()` method, and falls back to hardcoded defaults if the stored setting is null/unparseable/invalid. Returns `ResolvedActiveFilter` (resolved search input + source slug + original generic).                                                                                                                                        |
| `src/settings.ts`        | Runtime config layer: `getSetting(key, fallback?)` reads Postgres `Setting` table (or falls back to `defaultValues` map from `src/config.ts`); `setSetting(key, value)` writes after Zod validation + cross-key bounds checking (e.g., `indexTickIntervalMinutesMin` ≤ `indexTickIntervalMinutesMax`). 28 keys under `politeness.*`, `sweep.*`, `circuit.*`, `log.*`, `stats.*` namespaces.                                                                                           |
| `src/taxonomy-labels.ts` | Label LUT builder: parses two static taxonomy JSON files (1406 = houses, 1404 = apartments), builds three Maps (filterId → label, "filterId:featureId" → label, "filterId:featureId:optionId" → label), surfaces `getFilterLabel()` / `getFeatureLabel()` / `getOptionLabel()` query functions and `buildTaxonomyResponse()` for GET `/api/filter/taxonomy` to populate the SPA's filter form UI.                                                                                     |
| `src/parse-taxonomy.ts`  | Fallback LUT builder: `bootstrapLutFromConfig()` seeds a featureId → filterId map from hardcoded anchors in `FILTER.searchInput`; `parseTaxonomyResponse()` walks a raw GraphQL response tree (shape TBD) and emits (filterId, featureId) edges; `mergeLuts()` combines two maps (captured taxonomy wins on conflict). Used when a live taxonomy capture lands; currently bootstrap-only.                                                                                             |
| `src/sources/types.ts`   | Abstract source contract: `Source` interface (slug, name, `resolve(generic: GenericFilter) => ResolvedFilter`), `ResolvedFeature` discriminated union (optionIds array, or range with min/max/unit, or bare featureId), and `UnknownGenericFilterValueError` (thrown when a filter selection doesn't exist in the taxonomy).                                                                                                                                                          |
| `src/sources/999md.ts`   | Concrete 999.md adapter: `source999md` singleton. Maps `GenericFilter` to `ResolvedFilter.searchInput` by (1) category → subCategoryId lookup, (2) loading the category's taxonomy JSON, (3) validating each `FilterSelection` against the taxonomy (filterId exists, featureId under it exists, optionIds/unit under it exist), and (4) building a GraphQL-ready searchInput object grouped by filterId → features[]. Throws `UnknownGenericFilterValueError` on validation failure. |
| `src/sources/index.ts`   | Registry: `listSources()`, `getSource(slug)`, and `ACTIVE_SOURCE_SLUG = '999md'`. Currently only 999md is implemented; future sources (makler.md, lara.md) register here.                                                                                                                                                                                                                                                                                                             |
| `prisma/schema.prisma`   | Data models: `Setting` (key → valueJson), `Source` (slug, enabled, adapter overrides), `ListingFilterValue` (featureId, optionId, textValue, numericValue per listing), `Listing.filterValuesEnrichedAt` (timestamp when last `persistDetail` captured filter values).                                                                                                                                                                                                                |

## Data Flow & Control Flow

### Startup: Resolve Active Filter

1. **Resolver entry** — `resolveActiveFilter()` called at crawler/sweep startup.
2. **Load source** — `getSource(ACTIVE_SOURCE_SLUG)` returns `source999md` (only impl).
3. **Fetch stored setting** — `getSetting('filter.generic', null)` queries Postgres `Setting` table.
4. **Fallback on null** — If no row or value is null, return hardcoded defaults from `FILTER.searchInput` + `defaultGenericFilter`.
5. **Validate** — Parse the stored JSON via `genericFilterSchema.safeParse()`. If parse fails, fall back to defaults. NOTE: as currently implemented (`filter-resolver.ts:30-33`) the fallback is **silent** — there is no logger call and no `console.warn`. Any "log a warning here" requirement is aspirational, not implemented; tests must not assert a log line on this path.
6. **Resolve** — Call `source999md.resolve(genericFilter)`. `resolve()` is **synchronous** (`Source.resolve` returns `ResolvedFilter`, not a `Promise`); only `resolveActiveFilter()` itself is `async` (because `getSetting` hits Postgres).
7. **Merge metadata** — Return `ResolvedActiveFilter` = { searchInput, sourceSlug, generic }.
8. **No catch, no retry** — If `source.resolve()` throws `UnknownGenericFilterValueError`, the error **propagates uncaught** out of `resolveActiveFilter()`. The resolver does NOT log it, swallow it, or retry — the calling sweep/startup code is responsible for catching it. (Spec previously claimed "log and exit"; the code at `filter-resolver.ts:18-38` contains no try/catch and no logging.)

### Fallback: missing source

If `getSource(ACTIVE_SOURCE_SLUG)` returns `null` (slug not registered / source removed), `resolveActiveFilter()` returns the hardcoded fallback immediately, _before_ it ever reads the Setting table (`filter-resolver.ts:21-23`). The fallback's `generic` field is `defaultGenericFilter` and its `searchInput` is mapped from `FILTER.searchInput`.

### Operator sets filter via UI

1. **Form submission** — PUT `/api/filter` (singular) with a `GenericFilter` body.
2. **Validate** — Zod schema validates the shape (required: category, non-empty filters array, each selection is valid).
3. **Resolve preview** — Call `source999md.resolve(filter)` to catch validation errors early.
4. **Persist** — `setSetting('filter.generic', filter)` writes to Postgres.
5. **Return resolved output** — Echo back the `ResolvedActiveFilter` to the SPA (no server restart required).
6. **Next sweep** — On the next cron tick or manual trigger, `resolveActiveFilter()` reads the new setting.

### Taxonomy resolution (one-time or refresh)

1. **Query live taxonomy** — Call 999.md's `GetFilterTaxonomy` GraphQL query for the active category.
2. **Parse response** — Pass JSON to `parseTaxonomyResponse()` to extract (filterId, featureId) edges.
3. **Merge with bootstrap** — `mergeLuts(bootstrapLutFromConfig(), parsedLut)` — captured taxonomy wins on conflict.
4. **Cache in memory** — Store the result in a runtime Map (no persistence yet; this is plumbing for PR 2).
5. **Serve to SPA** — GET `/api/filter/taxonomy?subCategoryId=1406` calls `buildTaxonomyResponse(1406)` to construct a human-friendly list of filters, features, and option labels from the taxonomy JSON files.

### Label resolution (display in SPA)

1. **Fetch taxonomy endpoint** — SPA calls `GET /api/filter/taxonomy?subCategoryId=1406`.
2. **Build response** — `buildTaxonomyResponse(1406)` walks the 1406 taxonomy JSON, emits `TaxonomyFilter[]` (each with filterId, label, kind, and features[]).
3. **Populate UI** — SPA renders filter form with human-readable labels and enum options.
4. **Operator interaction** — Operator selects options, SPA builds a `GenericFilter` JSON.
5. **Submit** — PUT `/api/filter` (singular) with the `GenericFilter`.

### Parse & persist (on detail fetch)

1. **Detail page parse** — `parseDetail()` extracts FeatureValue nodes from the HTML (or GraphQL response).
2. **Build filter triples** — For each feature, emit a (featureId, optionId, textValue, numericValue) row to insert into `ListingFilterValue`.
3. **Resolve filterId** — Use the featureId → filterId LUT built from `parse-taxonomy.ts` (bootstrap + captured) to backfill `filterId`.
4. **Persist** — Insert `ListingFilterValue` rows per listing; set `Listing.filterValuesEnrichedAt = now()`.
5. **Mark backfill** — The next sweep can skip listings with a non-null `filterValuesEnrichedAt` timestamp and focus on older, un-enriched rows.

## Contracts & Types

### Input Contracts

**`GenericFilter`** (from operator UI)

```ts
{
  category: 'house' | 'apartment',
  filters: [
    {
      kind: 'options',
      filterId: 16,
      featureId: 1,
      optionIds: [776]
    },
    {
      kind: 'range',
      filterId: 9441,
      featureId: 2,
      unit: 'UNIT_EUR',
      min: '100000',
      max: '250000'
    },
    {
      kind: 'boolean',
      filterId: 5078,
      featureId: 1623
    }
  ]
}
```

**Setting schema** (Zod-validated)

```ts
{
  key: 'filter.generic',
  valueJson: GenericFilter
}
```

### Output Contracts

**`ResolvedFilter`** (to crawler/sweep)

`searchInput.source` is the union `'AD_SOURCE_DESKTOP' | 'AD_SOURCE_DESKTOP_REDESIGN'` (`sources/types.ts:10`). `source999md.resolve()` always emits the literal `'AD_SOURCE_DESKTOP_REDESIGN'` (hardcoded in `resolve()`); the legacy `'AD_SOURCE_DESKTOP'` value exists only in the type for forward-compat and is never produced by the current adapter. The resolved `features` entry is the `ResolvedFeature` union: `{ featureId }` (boolean), `{ featureId, optionIds }` (options), or `{ featureId, unit?, range: { min?, max? } }` (range) — `range` is always present on the range variant even when both bounds are absent, but `unit` is omitted entirely when the selection had no unit.

```ts
{
  searchInput: {
    subCategoryId: 1406,
    source: 'AD_SOURCE_DESKTOP_REDESIGN',
    filters: [
      {
        filterId: 16,
        features: [{ featureId: 1, optionIds: [776] }]
      },
      {
        filterId: 9441,
        features: [{
          featureId: 2,
          unit: 'UNIT_EUR',
          range: { min: '100000', max: '250000' }
        }]
      }
    ]
  }
}
```

**`TaxonomyFilter[]`** (for SPA filter form)

```ts
[
  {
    filterId: 16,
    label: 'Type of offer',
    kind: 'options',
    features: [
      {
        featureId: 1,
        label: 'Offer type',
        options: [
          { id: 776, label: 'Vând (for sale)' },
          { id: 903, label: 'De închiriat pe zi' },
        ],
      },
    ],
  },
  {
    filterId: 9441,
    label: 'Price',
    kind: 'range',
    features: [
      {
        featureId: 2,
        label: 'Total price',
        units: ['UNIT_EUR', 'UNIT_MDL', 'UNIT_USD'],
      },
    ],
  },
];
```

### Error Contracts

**`UnknownGenericFilterValueError`** (thrown by source.resolve())

```ts
{
  name: 'UnknownGenericFilterValueError',
  message: 'Unknown filterId value "9999" — not in source mapping',
  field: 'filterId' | 'featureId' | 'optionId' | 'unit' | 'category',
  value: string
}
```

HTTP layer surfaces as 400 Bad Request with field + value in the response body.

**Zod validation error** (thrown by setSetting / filter form validation)

```ts
{
  error: {
    issues: [
      {
        code: 'invalid_type',
        expected: 'number',
        received: 'string',
        path: ['filters', 0, 'filterId'],
        message: 'Expected number, received string',
      },
    ];
  }
}
```

## Invariants & Business Rules

1. **Opaque param IDs are sacred.** 999.md's filterId, featureId, optionId space is re-shuffled per category redesign. Never hardcode or guess — always copy from a real browser session or capture from the live GraphQL response. The config.ts bootstrap uses only known anchors from 2026-04-26 capture (filterId 16 = offer type, 32 = region, 9441 = price, 1073 = area). Anything else must come from the taxonomy JSON.

2. **Two-tier taxonomy resolution.** Bootstrap LUT from hardcoded anchors is a fallback; the authoritative source is a captured taxonomy JSON snapshot for the category (1406 = houses, 1404 = apartments). PR 2 will wire a live capture loop; until then, the JSON files are the ground truth and must be refreshed manually when 999.md's taxonomy shifts.

3. **Category drives subCategoryId.** `GenericFilter.category` ('house' or 'apartment') deterministically maps to a subCategoryId (1406 or 1404). Changing the category in the UI re-validates all filter selections against the new category's taxonomy — selections that don't exist in the new category are rejected.

4. **Settings mutations are atomic and consistent.** `setSetting()` validates the new value against its Zod schema before writing; cross-key constraints (min ≤ max for interval pairs) are enforced via partner lookups + rejection. A failed `setSetting()` throws immediately; the transaction is not written.

5. **Filter resolution is all-or-nothing.** If any selection in the filter is invalid (unknown filterId, featureId, optionId, unit), the entire `resolve()` call throws `UnknownGenericFilterValueError`. Partial success is not allowed — the operator sees the exact field that failed and can correct it.

6. **Price normalization is external.** The filter layer only carries strings (min/max bounds and unit enums like 'UNIT_EUR'). The crawler's `parseDetail()` function is responsible for converting a parsed price value + currency to EUR and storing both `priceRaw` (original text) and `priceEur` (normalized int) in the Listing row. The filter does not do unit conversion.

7. **Source adapters are deterministic.** Given the same `GenericFilter`, a source's `resolve()` must always produce the same `ResolvedFilter`. The resolution depends only on the filter selection and the taxonomy; it does not depend on external state, randomness, or time.

8. **Taxonomy labels are best-effort.** If a filterId, featureId, or optionId appears in the searchInput but lacks a corresponding label in the taxonomy JSON, the UI falls back to rendering the numeric ID. No error is thrown.

## Edge Cases & Failure Modes

1. **Setting key does not exist — fallback precedence** — `getSetting(key, fallback?)` resolution order (`settings.ts:285-306`) is, in this exact priority: (1) a committed Postgres `Setting` row (`valueJson` returned as-is, even if it is `null`); (2) the explicit `fallback` argument **but only when `fallback !== undefined`** — note this OUTRANKS the `defaultValues` map; (3) the `defaultValues` map entry for the key; (4) otherwise throw `Error('Setting key "<key>" not found and no default provided')`. Two consequences the prior spec text got backwards: the `fallback` parameter is checked _before_ `defaultValues`, not after; and passing `fallback: undefined` is indistinguishable from passing no fallback (because the guard is `!== undefined`), so `getSetting('politeness.baseDelayMs', undefined)` falls through to `defaultValues` and returns 8000. There is no way to force a `null`/`undefined` fallback to win over `defaultValues`.

2. **Stored filter is malformed JSON** — `getSetting('filter.generic', null)` returns the stored (possibly garbage) value. `genericFilterSchema.safeParse()` returns `{ success: false }` (not a throw), so `resolveActiveFilter()` **silently** returns the hardcoded defaults — there is no log line on this path (`filter-resolver.ts:30-33`). The SPA's form is not pre-populated with the invalid data; the operator sees the form in its default state and can re-submit. Note: this also fires for a structurally-valid-but-empty `{ category: 'house', filters: [] }`, which fails `genericFilterSchema`'s `.min(1)` on the filters array.

3. **Operator submits a filter with a deleted optionId** — 999.md's taxonomy evolves; an optionId that existed last week may be gone today. PUT `/api/filter` (singular) calls `source999md.resolve()` to validate; `validateOptionId()` throws `UnknownGenericFilterValueError('optionId', '9999')`. The HTTP layer returns 400; SPA shows the error to the operator (with the problematic value).

4. **Taxonomy JSON file is corrupted** — `buildIndex()` in `taxonomy-labels.ts` walks the structure defensively: `typeof f.id !== 'number' && continue`. Malformed nodes are silently skipped. The resulting label maps may be sparse, but the code does not throw.

5. **Source is disabled in the UI** — The `Source.enabled` flag gates whether the source is available for selection in the operator UI. A disabled source is not returned by `getSource()` or `listSources()`. If the operator explicitly tries to set an active filter for a disabled source, the API should validate and reject (implementation TBD in API layer).

6. **Cross-key bounds violated (both directions)** — `pairedBounds` (`settings.ts:311-349`) enforces `min ≤ max` on two pairs: `sweep.indexTickIntervalMinutesMin/Max` and `sweep.detailTrickleIntervalSecondsMin/Max`. The check is **symmetric** — it fires whether the operator writes the min or the max:
   - Writing the **min** too high: `setSetting('sweep.indexTickIntervalMinutesMin', 150)` with current max 120 throws `Error('sweep.indexTickIntervalMinutesMin (150) cannot exceed sweep.indexTickIntervalMinutesMax (120). Update sweep.indexTickIntervalMinutesMax first.')`.
   - Writing the **max** too low: `setSetting('sweep.indexTickIntervalMinutesMax', 30)` with current min 60 throws `Error('sweep.indexTickIntervalMinutesMax (30) cannot be less than sweep.indexTickIntervalMinutesMin (60). Update sweep.indexTickIntervalMinutesMin first.')` (different message wording).
     The partner value is read via `getSetting(partnerKey)` with NO fallback, so it resolves through the DB → `defaultValues` chain. The Zod schema validation (`schema.parse`) runs _before_ the bounds check, so a type error is reported before any cross-key comparison. The write is skipped entirely on a bounds violation (the throw precedes the `prisma.setting.upsert`).

7. **No taxonomy JSON for a category** — `buildTaxonomyResponse(9999)` calls `getIndex(9999)`, gets undefined, returns an empty array `[]`. The SPA renders an empty form (edge case; should only happen in testing or if a new category is added without wiring its taxonomy file).

8. **Async timing: sweep starts before a new setting is written** — Suppose the operator updates the filter at 09:15 and the next cron tick is at 09:30. The settings layer reads the Postgres row; there is a brief window where the write is in-flight but not yet committed. Postgres ACID isolation ensures the sweep reads either the old or new value atomically (not a mix); which one depends on the transaction order. No data corruption, just a timing variability (expected in distributed systems).

9. **Filter `type` not in `FILTER_KIND_MAP` is silently dropped** — `buildTaxonomyResponse()` (`taxonomy-labels.ts:131-146`) maps the raw `filter.type` string through `FILTER_KIND_MAP` (`FILTER_TYPE_OPTIONS → 'options'`, `FILTER_TYPE_RANGE → 'range'`, `FILTER_TYPE_FEATURES_AND → 'boolean'`). Any filter whose `type` is missing or is some _other_ `FILTER_TYPE_*` value (999.md ships several, e.g. checkbox/date variants) maps to `undefined` and is **skipped** (`if (!kind) continue`). The SPA therefore only ever sees filters of these three kinds; unsupported filter types are invisible in the form. This is distinct from a corrupt node — the node is well-formed, just an unrecognized kind.

10. **Range-filter unit collapsing in the taxonomy response** — For a `range` filter, `buildTaxonomyResponse()` reads `filter.units` (a filter-level array, NOT feature-level) and emits, per feature (`taxonomy-labels.ts:162-170`): a scalar `unit` when exactly one unit exists; a `units[]` array when more than one; and **neither key** when `units` is empty/null. The 1073 area filter (single `UNIT_METER_SQUARE`) therefore surfaces as `{ unit: 'UNIT_METER_SQUARE' }`, while 9441 price (`UNIT_EUR`/`UNIT_MDL`/`UNIT_USD`) surfaces as `{ units: [...] }`. Consumers must handle all three shapes.

11. **Non-numeric range bounds fail the `min ≤ max` refine** — The Zod range refine compares `Number(v.min) <= Number(v.max)` (`types/filter.ts:48-54`). If either bound is a non-numeric string, `Number()` yields `NaN` and `NaN <= NaN` is `false`, so the refine **fails** with "range min must be ≤ max" — note the error message is misleading (the real cause is an unparseable bound, not an ordering problem). The first refine (`min !== undefined || max !== undefined`) does NOT check numericness, so `{ min: 'abc' }` passes the first refine and only the empty `{}` is caught there. Leading/trailing whitespace and empty string `''` coerce to `NaN` too (except `''` → `0`).

12. **Duplicate featureId selections — options union vs. replace** — If the same `(filterId, featureId)` appears in more than one selection, `mergeIntoFilters()` (`sources/999md.ts`) behaves differently by kind: two `options` selections have their `optionIds` **unioned** (de-duplicated, order-preserving — existing first, then new ids not already present); for any other combination (range+range, boolean+anything, options+range) the **later selection silently replaces** the earlier one. There is no validation rejecting duplicate features, so a second price range silently wins over the first. Filters are grouped output-side by `filterId`, and within a filter by `featureId`.

## Configuration & Operational Notes

### Environment Variables

None required. All filter & taxonomy config is driven by:

- Hardcoded defaults in `src/config.ts` (bootstrap)
- Postgres `Setting` table rows (mutable via API)
- Static JSON files in `src/data/filter-taxonomy.*.json` (taxonomy, captured from live 999.md)

### Settings Keys

| Key                      | Type                   | Default                                                                   | Purpose                                               |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| `filter.generic`         | GenericFilter          | defaultGenericFilter (houses, region 8, area 90–200 m², price ≤ 250k EUR) | Active search filter                                  |
| `sweep.mode`             | 'legacy' \| 'two_tier' | 'legacy'                                                                  | Sweep cadence (PR 1 plumbing; PR 3 flips to two_tier) |
| `politeness.baseDelayMs` | number                 | 8000                                                                      | Base inter-request delay (ms)                         |
| `politeness.jitterMs`    | number                 | 2000                                                                      | Random jitter (±ms)                                   |
| ...                      | ...                    | ...                                                                       | (20+ others for sweep, circuit, logging)              |

### Taxonomy JSON Files

| File                                 | SubCategoryId     | Coverage                                  | Last Captured                                          |
| ------------------------------------ | ----------------- | ----------------------------------------- | ------------------------------------------------------ |
| `src/data/filter-taxonomy.1406.json` | 1406 (houses)     | ~80 filters, 200+ features, 3000+ options | 2026-05-09 (manual capture; auto-refresh planned PR 2) |
| `src/data/filter-taxonomy.1404.json` | 1404 (apartments) | ~75 filters, 190+ features, 2800+ options | 2026-05-09 (manual capture)                            |

### Operational Workflows

**Operator changes the filter** (e.g., expand price cap to €300k)

1. Navigate to the Settings > Filters page.
2. Edit the filter selections (e.g., change `{ kind: 'range', filterId: 9441, featureId: 2, max: '250000' }` to `{ max: '300000' }`).
3. Click "Save".
4. SPA PUTs to `/api/filter` (singular) with the new GenericFilter.
5. Crawler reads the new setting on the next cron tick (no restart required).

**Operator wants to add a new location filter**

1. Check the active category's taxonomy (GET `/api/filter/taxonomy?subCategoryId=1406`).
2. Find the location filterId and optionIds for the desired locations (e.g., filterId 32, Codru = optionId 13942).
3. Edit the filter form, add a new selection.
4. Save.

**999.md taxonomy is updated (new options appear live)**

1. Trigger a manual fetch of the live taxonomy via `/api/filter/taxonomy/refresh` (implementation: PR 2).
2. The new optionIds become available for selection immediately.
3. Operator updates the filter if needed.

### Sentinels & Flags

- **`FILTER` constant in src/config.ts** — Hardcoded bootstrap filter. Used when:
  - No `Setting('filter.generic')` row exists (first run).
  - The stored value is null or malformed.
  - A source is not available (fallback mode).
- **`ACTIVE_SOURCE_SLUG = '999md'`** — Hardcoded active source. Future: operator can select from available sources in Settings.

## Acceptance Criteria

1. **Resolve on startup** — `resolveActiveFilter()` is called at crawler startup and returns a valid `ResolvedActiveFilter` (even if it's the fallback).
2. **Validate filter selections** — `setSetting('filter.generic', invalidFilter)` rejects with a clear Zod or source error message (field + value named).
3. **Persist & reload** — Operator sets a filter via the API; next cron tick reads the new value from Postgres (verified via SweepRun.configSnapshot in PR 1 plumbing).
4. **Taxonomy labels are present** — GET `/api/filter/taxonomy?subCategoryId=1406` returns at least 50 filters with human-readable labels (not just numeric IDs).
5. **Category switching** — Operator changes `GenericFilter.category` from 'house' to 'apartment'; the resolver re-validates all selections against 1404 taxonomy. Selections that don't exist in 1404 are flagged.
6. **Cross-key bounds enforced** — `setSetting('sweep.indexTickIntervalMinutesMin', 150)` rejects if `indexTickIntervalMinutesMax` is less than 150.
7. **Fallback on missing setting** — Delete the `filter.generic` row from Postgres; `resolveActiveFilter()` returns the hardcoded defaults without throwing.
8. **Parse & persist filter values** — After `persistDetail()` enriches a listing with filter values, `Listing.filterValuesEnrichedAt` is set to a non-null timestamp. ListingFilterValue rows are inserted with valid (featureId, optionId) pairs resolved against the taxonomy LUT.

## Open Questions & Known Gaps

1. **Live taxonomy refresh (PR 2)** — Currently, taxonomy JSON files are static snapshots. PR 2 will wire a periodic `GetFilterTaxonomy` GraphQL query + cache-layer plumbing to refresh the LUT at runtime without a server restart. Until then, a manual JSON file update is needed when 999.md's taxonomy changes.

2. **Source-level filter overrides** — The `Source` model in Prisma includes `filterOverridesJson` (planned for PR 1 plumbing). This allows a source to define a per-source postfilter (e.g., "only show houses > 120 m²" for a specific source). Currently not wired; the HTTP layer ignores it.

3. **Operator source selection** — Currently `ACTIVE_SOURCE_SLUG = '999md'` is hardcoded. Phase B will add a Settings toggle to select the active source at runtime, with per-source politeness + filter overrides applied.

4. **Empty category handling** — If `GenericFilter.filters` is empty, validation rejects it (`.min(1)`). The operator is required to define at least one filter. Is this the right UX, or should we allow a "match all" filter with explicit defaults?

5. **Taxonomy refresh cadence** — When should the live capture run? On every sweep (expensive, 2x/day → 1 GraphQL call/sweep)? On a separate schedule (e.g., once daily)? Decoupled entirely (manual operator trigger)?

6. **Duplicate feature selections** — What happens if the operator selects the same featureId twice in the filter (e.g., two range selections on price)? The merger in `999md.ts` (mergeIntoFilters) handles optionIds union but replaces other kinds. Should we validate to prevent duplication client-side?

7. **Category-agnostic UI** — The SPA filter form is currently category-agnostic (shows all filters regardless of category). Should we hide category-specific filters client-side when the category is changed? Or is the server-side validation (UnknownGenericFilterValueError on resolve) sufficient?

8. **Price normalization in filter** — The filter layer stores price as a string range. Should we add a normalized-price validator (e.g., "max must be < 500000 EUR after normalization")? Or is that the crawler's job?

9. **Memory of old filter IDs** — If an optionId is deleted from 999.md's taxonomy, listings already stored in the DB have ListingFilterValue rows with that optionId. Queries need to handle stale IDs gracefully (expected; the LUT gracefully ignores unknown IDs on new parses).

# Multi-source abstraction & 999.md adapter

## Purpose & scope

The source abstraction enables the crawler and UI to support multiple real estate data sources without duplicating filter-resolution, sweep orchestration, or persistence logic. Each source implements a pluggable adapter that translates a generic filter shape (category + feature selections) into source-specific GraphQL / HTTP search inputs. Currently 999.md is the only deployed adapter; the architecture is ready for makler.md and lara.md via new adapter implementations.

## Architecture & key modules

| File path                | Responsibility                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/sources/types.ts`   | `Source` interface, `ResolvedFilter` shapes, `UnknownGenericFilterValueError` exception                                              |
| `src/sources/index.ts`   | Registry: `listSources()`, `getSource(slug)`, `ACTIVE_SOURCE_SLUG = '999md'`                                                         |
| `src/sources/999md.ts`   | 999.md adapter: `resolve(GenericFilter) → ResolvedFilter`; maps generic selections to GraphQL `searchInput`                          |
| `src/types/filter.ts`    | `GenericFilter` (category + `FilterSelection[]`), `Category` enum, `defaultGenericFilter`                                            |
| `src/filter-resolver.ts` | Loads persisted generic filter from `Setting['filter.generic']`, passes through source's `resolve()`, falls back to hardcoded FILTER |
| `src/config.ts`          | Hardcoded fallback filter and 999.md GraphQL inputs (FILTER.searchInput)                                                             |
| `prisma/schema.prisma`   | `Source` model (slug, name, baseUrl, adapterKey, enabled, politenessOverridesJson, filterOverridesJson)                              |

## Data flow / control flow

### 1. Filter resolution at sweep start

1. `resolveActiveFilter()` called (from crawler or UI initialization). It is `async` and returns `Promise<ResolvedActiveFilter>` — **never `null`** (`src/filter-resolver.ts:17`).
2. Resolve order in code (`src/filter-resolver.ts:17-38`):
   1. Look up source from registry: `getSource(ACTIVE_SOURCE_SLUG)`. If `null` → `fallback(sourceSlug)`.
   2. Fetch `Setting['filter.generic']` via `getSetting<unknown>('filter.generic', null)`. If `null`/`undefined` → `fallback(sourceSlug)`.
   3. Parse the stored value with `genericFilterSchema.safeParse(...)`. If `!success` → `fallback(sourceSlug)`.
   4. Otherwise call `source.resolve(parsed.data)` and return `{ ...resolved, sourceSlug, generic }`.

**Behavior facts (do not embellish):**

- **No logging.** `resolveActiveFilter()` / `fallback()` emit **no log line at all** on any fallback branch (`src/filter-resolver.ts:41-87`). There is no WARN, INFO, or any pino call. An operator only discovers a fallback by inspecting the resulting filter. (Adding a WARN log is a TODO — see Open questions.)
- **`fallback()` does NOT call `source.resolve()`.** It synchronously builds a `ResolvedActiveFilter` by re-shaping the hardcoded `FILTER.searchInput` from `src/config.ts` and pairing it with `defaultGenericFilter` as the `generic` field (`src/filter-resolver.ts:41-87`). So on the missing-source, missing-setting, and invalid-setting branches the active source's `resolve()` is never invoked.
- **`source.resolve()` is NOT wrapped in try/catch.** It is called only on the happy path (valid source + valid stored filter). If `resolve()` throws `UnknownGenericFilterValueError` (e.g. a persisted filter references a filterId since dropped from the taxonomy), the error **propagates out of `resolveActiveFilter()`** — it does **not** trigger the fallback. The caller (crawler/sweep) is responsible for handling it. This means a poisoned persisted filter can hard-fail sweep start even though a fallback path exists.

**Invariant:** `resolveActiveFilter()` always returns a `ResolvedActiveFilter` _unless_ a persisted-but-now-invalid filter makes `source.resolve()` throw. The three explicit fallback branches (no source / no setting / unparseable setting) always succeed; the parsed-but-unresolvable case does not.

### 2. Source.resolve(genericFilter)

For 999.md specifically (in `src/sources/999md.ts`):

1. Map `generic.category` ('house' or 'apartment') to `subCategoryId` (1406 or 1404).
2. For each `FilterSelection` in `generic.filters`:
   - Look up the filter definition in the taxonomy (loaded from JSON fixtures: `filter-taxonomy.1406.json`, `filter-taxonomy.1404.json`).
   - Validate `filterId` (must exist in taxonomy for the category) — `getFilter` (`999md.ts:46`).
   - Validate `featureId` (must exist under that filterId) — `getFeature` (`999md.ts:52`).
   - For 'options' kind: validate each `optionId` exists under the feature — `validateOptionId` (`999md.ts:58`).
   - For 'range' kind: validate unit **only if `sel.unit !== undefined`** is in the filter's `units` list — `validateUnit` (`999md.ts:63`). `min`/`max` are **not** validated by `resolve` (no min≤max check, no "at least one bound" check — those live in the Zod `rangeSelectionSchema` only, `src/types/filter.ts:45-54`).
   - For 'boolean' kind: no further validation needed.
   - Build a `ResolvedFeature` (shape depends on kind).
3. Merge resolved features keyed by `filterId` then `featureId` (`mergeIntoFilters`, `999md.ts:73`):
   - **options + options on the same `(filterId, featureId)`** → union the `optionIds` (de-duplicated; preserves first-seen order). This is the only merge that combines.
   - **any other repeat** (range+range, boolean+boolean, or a mixed-kind clash like options then range on the same feature) → **last write wins**; the earlier feature is silently overwritten (`999md.ts:96`).
4. Return `ResolvedFilter` with `searchInput: { subCategoryId, source: 'AD_SOURCE_DESKTOP_REDESIGN', filters: [...] }`. `subCategoryId` is computed from `generic.category` via `CATEGORY_SUBCATEGORY_MAP`; `source` is **hardcoded** to `'AD_SOURCE_DESKTOP_REDESIGN'` (the `AD_SOURCE_DESKTOP` variant in the type union is never produced by 999.md). Output order: `filters[]` follows filterId first-insertion order; `features[]` within a filter follows featureId first-insertion order (Map iteration).

**Throw behavior:** If ANY validation fails, throw `UnknownGenericFilterValueError(field, value)` with the failing field name. The error message is exactly `Unknown ${field} value "${value}" — not in source mapping` (`types.ts:35`) and `value` is always stringified via `String(...)`. The first failing selection throws immediately; later selections are not processed (no partial result, no aggregated error list). HTTP layer catches this and returns 400.

**`resolve` trusts Zod pre-validation for shape, not content.** When called via `/api/filter` (the singular PUT) or `resolveActiveFilter`, the input has already passed `genericFilterSchema`. But `resolve` itself does **not** re-check the Zod-only invariants: an `options` selection with `optionIds: []` produces `{ featureId, optionIds: [] }` (the validation loop runs zero times — no throw); a `range` with neither `min` nor `max` produces `range: {}`. Direct callers (unit tests, future internal callers) that bypass Zod can therefore obtain these degenerate shapes without error.

### 3. Registry entry / lookup

- `listSources()`: Returns `[source999md]` (read-only array).
- `getSource(slug: string)`: Linear search; returns source or null.
- At startup, the crawler reads `ACTIVE_SOURCE_SLUG` and verifies the source exists; if not, startup fails.

### 4. UI filter form persistence flow

1. Operator edits filter via the Settings page (Vite SPA).
2. Form validation via Zod schema (react-hook-form).
3. On submit, `PUT /api/filter` (singular) with `{ generic: GenericFilter }`.
4. Server validates via `genericFilterSchema`, then calls active source's `resolve()`.
5. If validation fails (unknown filterId, unknown optionId, etc.), return 400 with `UnknownGenericFilterValueError` details.
6. On success, upsert `Setting['filter.generic']` with the generic filter JSON.
7. Next sweep will pick up the new filter.

**Concurrency:** Settings updates do not interrupt in-flight sweeps; a sweep in progress holds the current `ResolvedActiveFilter` snapshot. The new filter takes effect on the next sweep.

## Contracts & types

### `Source` interface (src/sources/types.ts)

```typescript
interface Source {
  slug: string; // e.g., "999md", "lara", "makler"
  name: string; // Human-readable: "999.md", "Lara", "Makler"
  resolve: (generic: GenericFilter) => ResolvedFilter;
  // Throws UnknownGenericFilterValueError on invalid selections
}
```

### `GenericFilter` (src/types/filter.ts)

```typescript
interface GenericFilter {
  category: 'house' | 'apartment';
  filters: FilterSelection[];
}

type FilterSelection =
  | { kind: 'options'; filterId: number; featureId: number; optionIds: number[] }
  | {
      kind: 'range';
      filterId: number;
      featureId: number;
      unit?: string;
      min?: string;
      max?: string;
    }
  | { kind: 'boolean'; filterId: number; featureId: number };
```

### `ResolvedFilter` (src/sources/types.ts)

```typescript
interface ResolvedFilter {
  searchInput: ResolvedSearchInput;
}

interface ResolvedSearchInput {
  subCategoryId: number;
  source: 'AD_SOURCE_DESKTOP' | 'AD_SOURCE_DESKTOP_REDESIGN';
  filters: Array<{
    filterId: number;
    features: ResolvedFeature[];
  }>;
}

type ResolvedFeature =
  | { featureId: number }
  | { featureId: number; optionIds: number[] }
  | { featureId: number; unit?: string; range: { min?: string; max?: string } };
```

### `UnknownGenericFilterValueError`

Thrown by a source's `resolve()` when the generic filter contains unmapped values.

```typescript
class UnknownGenericFilterValueError extends Error {
  readonly field: string; // e.g., "filterId", "optionId", "unit"
  readonly value: string; // e.g., "99999"
  constructor(field: string, value: string);
}
```

### `ResolvedActiveFilter` (src/filter-resolver.ts)

```typescript
interface ResolvedActiveFilter extends ResolvedFilter {
  sourceSlug: string; // e.g., "999md"
  generic: GenericFilter; // Original input for UI round-trips
}
```

## Invariants & business rules

1. **One active source per deployment.** `ACTIVE_SOURCE_SLUG` is hardcoded; no per-sweep selection exists yet. Changing it requires a code change and restart.

2. **Taxonomy is immutable at runtime.** Filter taxonomy (feature/option definitions) lives in JSON fixtures (`filter-taxonomy.1404.json` for apartments, `filter-taxonomy.1406.json` for houses). These are loaded once at module init and never reloaded. To add a feature, push a new version of the fixture and restart.

3. **Fallback always succeeds.** If the active source is not registered, the crawler falls back to hardcoded `FILTER` in `src/config.ts` so production doesn't break. The fallback is **silent** — no WARN (or any) log line is emitted (`src/filter-resolver.ts:41-87`); an operator only discovers it by inspecting the resulting filter. Adding a WARN log is a TODO (see Open questions).

4. **Validation is eager and explicit.** All lookups in the taxonomy (filterId, featureId, optionId, unit) are validated during `resolve()`. Invalid selections cause an immediate throw; partial success is not possible. This prevents silent data loss if the operator typos a filter ID.

5. **Feature merging only combines options.** Two `options` selections on the same `(filterId, featureId)` union their `optionIds` (de-duped, first-seen order). Every other repeat on the same `(filterId, featureId)` — range+range, boolean+boolean, or a mixed-kind clash (e.g. options then range) — is **last-write-wins**: the earlier `ResolvedFeature` is silently overwritten (`999md.ts:90-96`). No throw, no warning. Operators relying on emitting two ranges for one feature will lose the first one silently.

6. **DefaultGenericFilter is the single source of truth for the production default filter.** It is tuned to match the POC acceptance criteria (houses in Chișinău + Durlești, ≤200m², ≤€250k) and uses the CORRECT feature IDs (feature 8 for Localitate, NOT feature 7 for Regiune). See the regression guard in `src/__tests__/sources/999md.test.ts` ("240 vs 482 fix").

7. **999.md category mapping is hardcoded:** house → 1406, apartment → 1404. No dynamic lookup; these are 999.md API constants.

8. **No source-specific filter overrides in this phase.** The `Source` model has `filterOverridesJson` and `politenessOverridesJson` columns for future use. Currently they are NULL and ignored.

## Edge cases & failure modes

### Missing taxonomy entry

If the JSON fixture is incomplete or corrupted (e.g., filterId 1073 not present in `filter-taxonomy.1406.json`):

- `resolve()` throws `UnknownGenericFilterValueError('filterId', '1073')` with message `Unknown filterId value "1073" — not in source mapping`.
- When the bad filter is submitted via `PUT /api/filter` (singular), the HTTP layer catches it and returns 400 with the error details (it is never persisted).
- When the bad filter is **already persisted** and a sweep starts, `resolveActiveFilter()` calls `source.resolve()` on the happy path — the throw **propagates uncaught out of `resolveActiveFilter()`** (`src/filter-resolver.ts:36`, no try/catch). There is no fallback for this case and no log line; the caller (sweep) must decide what to do. The spec'd "filter persists in ERROR state" behavior is **not** implemented in the source under review — it depends on the sweep caller, which is out of scope for these files.

**Mitigation:** Validate fixtures at startup (not yet implemented). TODO: add a boot-time check that the default filter resolves without error, AND wrap `source.resolve()` in `resolveActiveFilter()` with a try/catch that falls back instead of propagating.

### Source not registered

If `ACTIVE_SOURCE_SLUG = '999md'` but no adapter is in the registry:

- `resolveActiveFilter()` calls `getSource('999md')` → null.
- Fallback triggers: `fallback(sourceSlug)` returns a `ResolvedActiveFilter` built from the hardcoded `FILTER.searchInput` (`src/config.ts`) with `generic = defaultGenericFilter`. **No log line is emitted** (`src/filter-resolver.ts:41-87`).
- The fallback does **not** call any source's `resolve()` — it re-shapes `FILTER` directly. So the fallback works even when zero adapters are registered.
- Sweep uses the fallback filter; nothing is surfaced to the operator (there are no logs to check, contrary to earlier wording).

**Mitigation:** At startup, verify the active source is registered. If not, log ERROR and refuse to start the crawler. TODO: add this check to `src/index.ts`. Also TODO: add a WARN log inside `fallback()` so operators can detect the degraded path.

### Operator edits filter while sweep is in flight

1. Operator changes filter in UI, persists to Setting table.
2. Current sweep holds the old `ResolvedActiveFilter` and continues to completion.
3. Next sweep picks up the new filter via `resolveActiveFilter()`.

No transaction or lock; this is eventual consistency. By design to avoid deadlocks during long sweeps.

### Category mismatch in the UI

Operator selects "apartment" but tries to add a house-specific feature (e.g., "Stare casă" from filterId 1207):

- Form validation will fail because `react-hook-form` loads the taxonomy client-side and filters feature/option lists by category.
- If an old browser cache or manual request bypasses the form, the server-side `resolve()` will catch it and throw `UnknownGenericFilterValueError('filterId', ...)`.
- Operator gets a 400 response with clear error messaging.

**Note on `category` itself:** `resolve()` guards an out-of-enum category twice (`999md.ts:155-163`): `CATEGORY_SUBCATEGORY_MAP[generic.category]` yields `undefined`, then the `TAXONOMY_BY_SUBCATEGORY` lookup also misses — either path throws `UnknownGenericFilterValueError('category', ...)`. In practice this throw is unreachable from `PUT /api/filter` (singular) and `resolveActiveFilter` because `genericFilterSchema` (`z.enum(CATEGORIES)`, `src/types/filter.ts:69`) rejects unknown categories first with a Zod error, not `UnknownGenericFilterValueError`. The `category` throw only fires for direct/test callers that bypass Zod. Both registered subcategories (1406, 1404) always have a taxonomy map, so the second guard is effectively dead code today.

### Unit mismatch (e.g., UNIT_PARSEC)

If a range selection includes a unit not in the filter's `units[]` array:

- `resolve()` throws `UnknownGenericFilterValueError('unit', 'UNIT_PARSEC')`.
- HTTP 400 response with clear error text.

### Empty filter

If operator clears all selections and submits:

- Client-side and server-side validation (Zod `genericFilterSchema`, `filters.array().min(1)`, `src/types/filter.ts:70`) rejects with a Zod error before `resolve()` runs.
- Submit is blocked with a 400.
- **However, `resolve()` itself does NOT enforce a non-empty filter list.** Called directly with `{ category, filters: [] }`, it returns a valid `ResolvedFilter` with `searchInput.filters: []` (the for-loop in `999md.ts:167` iterates zero times). `defaultGenericFilter` is never empty, so `resolveActiveFilter`'s fallback path never produces an empty filter, but a direct caller can.

### Feature drift (new feature added to 999.md taxonomy)

999.md releases a new feature (e.g., "Solar panels: yes/no") and publishes an updated taxonomy query:

1. Developer manually fetches the new taxonomy GraphQL and updates the JSON fixture files.
2. Fixture gets deployed with code.
3. Operator can now select "Solar panels" in the form.
4. Old persisted filters (without Solar panels) still resolve correctly; Solar panels is optional.

No auto-discovery; fixtures are maintained by hand. TODO: Add a script to re-fetch taxonomies from 999.md GraphQL at build time.

## Configuration & operational notes

### Environment variables

- `ACTIVE_SOURCE_SLUG` — Hardcoded as `'999md'` in `src/sources/index.ts`. To change, edit source and restart.

### Hardcoded filter fallback (src/config.ts)

The `FILTER` object contains:

- `searchInput` — GraphQL input shape (subCategoryId, source, filters).
- Mirrors the 999.md GraphQL schema.
- Updated manually when the crawler logic changes.
- Used when Setting['filter.generic'] is not found or invalid.

### Prisma Source model

Columns:

- `slug` (unique) — e.g., "999md".
- `name` — Human-readable; displayed in the Operator UI.
- `baseUrl` — Base URL for the source (e.g., "https://999.md/ro").
- `adapterKey` — Adapter implementation key; currently only "999md" is functional.
- `enabled` — Boolean; operator can toggle via the UI.
- `politenessOverridesJson` — NULL; reserved for per-source rate-limit tuning (Phase P2).
- `filterOverridesJson` — NULL; reserved for per-source default filter overrides (Phase P2).
- `createdAt`, `updatedAt` — Audit timestamps.

Currently, only the "999md" source is seeded in the database. The Operator UI can list and toggle it, but there is no UI to create new sources yet.

### Registry order

`listSources()` returns sources in definition order from `REGISTRY` array. If future sources are added, insertion order matters only for cosmetic UI listing. Lookup is slug-based (getSource) so order does not affect resolution.

## Acceptance criteria

1. A developer can add a new source adapter by:
   - Creating `src/sources/<slug>.ts` with a `Source` object implementing `resolve()`.
   - Exporting it from `src/sources/index.ts` and adding it to `REGISTRY`.
   - The new source appears in `listSources()` immediately.
   - Tests verify the new source's resolve logic without mocking.

2. The active source's `resolve()` is called during every sweep and every filter form submission (via `PUT /api/filter`, singular).

3. If `resolve()` throws `UnknownGenericFilterValueError`, the HTTP layer catches it and returns 400 with error details visible to the operator.

4. If the active source is not registered, `resolveActiveFilter()` falls back to the hardcoded `FILTER` (re-shaped from `src/config.ts`). NOTE: no warning is logged today — the fallback is silent (`src/filter-resolver.ts:41-87`). A WARN log is a TODO.

5. The `defaultGenericFilter` is verified to resolve correctly at module load time without throwing (unit test guards this).

6. Changing the active source requires a code change to `ACTIVE_SOURCE_SLUG` and a crawler restart.

7. The Operator UI can list, enable/disable, and (in future) delete sources via the Settings page.

## Open questions / known gaps

1. **Dynamic source registration.** Currently sources are hardcoded in the registry. A future phase could expose an API (`POST /api/sources`, `DELETE /api/sources/:id`) to add/remove sources at runtime without restart. The Source model schema supports this, but no UI or crawl-side logic exists.

2. **Per-source default filters.** The `Source` model has `filterOverridesJson` but it is not read anywhere. A future phase could allow each source to define its own default filter shape, falling back to `defaultGenericFilter` if not set. Useful when activating a second source (e.g., makler.md) with different category/feature mappings.

3. **Per-source politeness settings.** The `Source` model has `politenessOverridesJson` but it is not read. A future phase could allow the operator to tune rate limits per source (e.g., makler.md might allow faster requests than 999.md). Currently politeness is global.

4. **Auto-fetching taxonomy.** The JSON fixtures are manually maintained. A script could re-fetch them from 999.md's GraphQL at build time, but this requires careful error handling (API might be down) and fixture validation.

5. **Cross-source dedup.** When multiple sources are active (Phase 5 in poc-spec.md), the crawler will face duplicate listings (same property posted on 999.md and makler.md). Dedup logic (pHash on images, fuzzy match on title+price+area) is not yet designed. The current Source interface assumes one source per sweep.

6. **Schema drift detection.** If 999.md removes a feature or renames an option, the parse/resolve logic will silently skip it (graceful degradation). Better: validate the deployed taxonomy against a baseline at startup and alert if drift is detected. TODO: implement in a future phase.

7. **Operator UI source switching.** The UI currently shows sources as read-only in the Settings view. To support operator-driven source switching, add a radio-button or dropdown above the filter form and update `PUT /api/filter` (singular) to accept `{ sourceSlug, generic }`. Requires careful UX (switching sources might invalidate the current filter selections).

8. **Uncaught `resolve()` on a poisoned persisted filter.** `resolveActiveFilter()` wraps the missing-source / missing-setting / unparseable-setting cases in `fallback()`, but does NOT try/catch the happy-path `source.resolve()` call (`src/filter-resolver.ts:36`). A persisted filter that parses against Zod but references a taxonomy entry later removed from the fixture will make `resolve()` throw, and that throw escapes `resolveActiveFilter()` instead of falling back. Decide whether sweep start should fall back, hard-fail, or quarantine the filter. Also: `resolveActiveFilter()` and `fallback()` emit zero logs, so every fallback is currently invisible in operations — add structured WARN logging.

9. **No-op / silent overwrites in `resolve()`.** `resolve()` trusts Zod for content invariants it does not re-check: empty `optionIds`, range with no bounds, and last-write-wins clobbering of repeated non-options features on the same `(filterId, featureId)`. These are unreachable via `PUT /api/filter` (singular; Zod gates them) but reachable by any internal/test caller. Decide whether `resolve()` should defensively re-validate or stay a pure mapper that assumes pre-validated input.

10. **Transaction isolation on filter edits.** If two concurrent requests edit the filter or source config, Postgres SERIALIZABLE isolation prevents lost updates, but no explicit lock is held. A sweep reading the filter mid-transaction might see a half-updated state. In practice, settimeout/eventual consistency is acceptable; consider adding advisory locks if needed later.

---

**Last updated:** 2026-06-01  
**Context:** Phase 4 Operator UI delivered; sources abstract ready for makler.md and lara.md.

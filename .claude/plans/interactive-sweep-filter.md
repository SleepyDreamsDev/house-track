# Plan: Interactive Sweep Filter (generic → source-mapped)

## Goal
Replace `src/config.ts` `FILTER.searchInput` (hardcoded 999.md GraphQL filter IDs) with a UI-editable, DB-persisted **generic** filter (`price_min/max`, `sqm_min/max`, `locality[]`, `category`, `transaction_type`) translated to source-specific GraphQL inputs by a per-source `FilterMapping`, so operators can retarget sweeps without redeploy and a second source can be added later by registering another mapping.

## Acceptance Criteria

- `GET /api/filter` returns the persisted generic filter for the active source (or seeded default mirroring today's `FILTER.searchInput`) with shape `{ sourceId, generic: GenericFilter, resolved: { searchInput, postFilter } }`.
- `PUT /api/filter` validates body via Zod, upserts the generic filter row, and returns 400 with field path on invalid input (negative numbers, min>max, unknown category, etc.).
- The 999.md `FilterMapping` translates `{ transaction_type: 'sale', locality: ['chisinau'] }` to today's exact `searchInput` (filterId 16 / featureId 1 / optionId 776; filterId 32 / featureId 7 / optionId 12900) — proven by a parity unit test against the current constant.
- `runSweep` reads the active source's generic filter from DB at sweep start (via a `resolveActiveFilter()` helper) and uses its resolved `searchInput`; touching the row before the next tick changes the GraphQL request body without a restart.
- When DB has no `FilterPreset` row, `resolveActiveFilter()` falls back to the constant in `src/config.ts` (existing behavior preserved). A migration seed inserts the default so production is explicit, not implicit.
- `postFilter` (`maxPriceEur`, `maxAreaSqm`) is derived from `price_max` / `sqm_max` in the generic filter; `applyPostFilter` keeps working unchanged.
- The SPA exposes a "Filter" page (or section in Sweeps) with form fields `Transaction type` (select), `Category` (select), `Locality` (multi-select chips), `Price min/max` (€), `Sqm min/max`; submit triggers PUT, optimistic update, success toast.
- Source registry contains at least `999md`; UI shows a source selector even though only one is registered (renders disabled or single-option select). Adding a second adapter requires only registering a new `Source` + `FilterMapping`, no UI change.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass.

## Architecture

- **Generic filter shape** — `src/types/filter.ts`: `GenericFilter = { transactionType: 'sale'|'rent'; category: 'house'|'apartment'|...; locality: string[]; priceMin?: number; priceMax?: number; sqmMin?: number; sqmMax?: number; currency: 'EUR' }`. Zod schema `genericFilterSchema` exported from same file with `.refine()` for `min<=max` invariants.
- **Source registry** — `src/sources/index.ts` exports `Source` interface `{ slug; name; mapping: FilterMapping; resolve(generic): { searchInput, postFilter } }`. `src/sources/999md.ts` implements it. Registry is a static `Map<string, Source>` keyed by `Source.adapterKey` (column already exists). Lookup: `getSource(adapterKey)`.
- **FilterMapping** — declarative table living next to the adapter: `{ transactionType: { sale: { filterId:16, featureId:1, optionIds:[776] } }, locality: { chisinau: { filterId:32, featureId:7, optionIds:[12900] } }, category: { house: { subCategoryId: 1406 } } }`. `resolve()` walks the mapping and assembles `searchInput` (subCategoryId + filters[] array) plus `postFilter` (price/area).
- **Persistence** — new model `FilterPreset { id Int @id @default(autoincrement()) sourceId Int @unique active Boolean @default(true) genericJson Json updatedAt DateTime @updatedAt source Source @relation(...) }`. One row per source for now (`@unique` on sourceId). Future "named presets" can drop unique and add `name`, but YAGNI for this slice.
- **API** — `src/web/routes/filter.ts`: `GET /api/filter` (returns active source's preset + resolved); `PUT /api/filter` (Zod-validated body `{ generic: GenericFilter }`, optional `?source=<slug>`, defaults to first enabled). Re-uses Zod from `src/types/filter.ts`.
- **Reading at sweep start** — new helper `src/filter-resolver.ts` exporting `resolveActiveFilter(prisma): Promise<{ searchInput, postFilter, sourceSlug }>`; `index.ts buildDeps()` calls it and threads `searchInput` into `buildSearchVariables(pageIdx, searchInput)` (signature gains an optional override; existing fallback keeps `FILTER.searchInput`).
- **UI** — new page `web/src/pages/Filter.tsx` (route `/filter`) with `react-hook-form` + `zodResolver` (mirrors the same `genericFilterSchema` exported via shared package or duplicated literal — see Risks). Uses existing `Input`, `Toggle`, `Button`, `Card` components. Locality multi-select can reuse a chip pattern (build a small `Chips` component if missing). New nav link in `AppShell` between "Sweeps" and "Settings". TanStack Query mutation invalidates `['filter']` on success.

## Tasks (in build order)

1. **Prisma**: add `FilterPreset` model + migration `add_filter_preset` (run with `pnpm prisma migrate dev --name add_filter_preset`). Add `presets FilterPreset[]` back-relation on `Source`.
2. **Generic types + Zod**: create `src/types/filter.ts` with `GenericFilter`, `genericFilterSchema`, locality/category enums (start narrow: `['chisinau','durlesti','codru','colonita']`, `['house','apartment']`, `['sale','rent']`).
3. **Source adapter scaffold**: `src/sources/types.ts` (`Source`, `FilterMapping`), `src/sources/999md.ts` with the mapping table + `resolve()`. Unit test: `resolve({transactionType:'sale', locality:['chisinau'], category:'house', priceMax:250000, sqmMax:200})` deep-equals current `FILTER.searchInput` + `FILTER.postFilter`.
4. **Registry + resolver**: `src/sources/index.ts` (`getSource`, `listSources`); `src/filter-resolver.ts` (`resolveActiveFilter` — reads `FilterPreset` joined to enabled `Source`, picks first if multiple, falls back to seed when row is missing).
5. **Refactor config seed**: keep `FILTER.searchInput` literal in `src/config.ts` but mark it `// FALLBACK SEED — runtime reads FilterPreset`. Seed migration script (`prisma/seed.ts` if absent) inserts the default `Source` (`999md`) + matching `FilterPreset` row equivalent to today's hardcoded values. Idempotent on `sourceId`.
6. **Refactor sweep wiring**: `src/index.ts buildDeps()` calls `resolveActiveFilter()` and passes resolved `searchInput` + `postFilter` into the existing fetch/parse-index callbacks. `buildSearchVariables(pageIdx, searchInput?)` gets an optional override param; default still reads `FILTER.searchInput` so smoke + tests stay green during transition.
7. **API routes**: `src/web/routes/filter.ts` (GET/PUT). Wire in `src/web/server.ts`. Validation errors return 400 with `{ error, details: [{ path, message }] }` — match `settings.ts` style.
8. **SPA page**: `web/src/pages/Filter.tsx`, route in `web/src/router.tsx`, nav link in `AppShell`, react-query `useQuery(['filter'])` + `useMutation`. Simple form layout: 2-col grid, range pairs (min/max) side-by-side, locality chips with toggle behavior.
9. **Source selector** (optional, low cost): dropdown atop the form bound to `GET /api/sources?enabled=true`. Single-source UX: render disabled but visible — proves the abstraction.

## File Map

| Action | File | Notes |
|--------|------|-------|
| add | `prisma/schema.prisma` | new `FilterPreset` model, back-relation on `Source` |
| add | `prisma/migrations/<ts>_add_filter_preset/migration.sql` | generated by Prisma |
| add | `prisma/seed.ts` (or extend existing) | seed `Source(999md)` + default `FilterPreset` |
| add | `src/types/filter.ts` | `GenericFilter`, Zod schema, enums |
| add | `src/sources/types.ts` | `Source`, `FilterMapping` interfaces |
| add | `src/sources/999md.ts` | mapping table + `resolve()` for 999.md |
| add | `src/sources/index.ts` | `getSource`, `listSources`, registry |
| add | `src/filter-resolver.ts` | `resolveActiveFilter(prisma)` |
| edit | `src/config.ts` | annotate `FILTER.searchInput` as fallback seed |
| edit | `src/graphql.ts` | `buildSearchVariables(pageIdx, searchInput?)` accepts override |
| edit | `src/index.ts` | `buildDeps()` calls `resolveActiveFilter()`, threads result through |
| edit | `src/parse-index.ts` | `applyPostFilter` already takes a `PostFilter` arg — pass resolved one (no signature change) |
| add | `src/web/routes/filter.ts` | GET/PUT `/api/filter` |
| edit | `src/web/server.ts` | register filter routes |
| add | `src/__tests__/sources/999md.test.ts` | parity test (mapping → existing constant) |
| add | `src/__tests__/filter-resolver.test.ts` | DB row vs fallback paths |
| add | `src/web/__tests__/routes/filter.test.ts` | GET/PUT integration test (testcontainers) |
| add | `web/src/pages/Filter.tsx` | form page |
| edit | `web/src/router.tsx` | add `/filter` route |
| edit | `web/src/components/layout/AppShell.tsx` | nav link |
| add | `specs/interactive-sweep-filter.feature` | Gherkin: GET, PUT, mapping parity, sweep reads from DB, fallback, UI flow |

## Verification

- **Unit**: `999md.test.ts` — `resolve({transactionType:'sale', locality:['chisinau'], category:'house', priceMax:250000, sqmMax:200})` deep-equals current `FILTER.searchInput` + `FILTER.postFilter`. Edge: unknown locality → throws or filtered with warning (decide in implementation; spec it).
- **Unit**: `genericFilterSchema` rejects `priceMin > priceMax`, negative numbers, empty `locality` array.
- **Integration**: `filter-resolver.test.ts` — when `FilterPreset` row exists, returns its resolved input; when absent, returns seed equivalent to `FILTER.searchInput`.
- **Integration**: `filter.test.ts` — `PUT /api/filter` with valid body persists row; subsequent `GET /api/filter` reflects it; invalid body returns 400 with field path.
- **Integration**: extend an existing sweep test to insert a `FilterPreset` with a different `priceMax`, run `runSweep` against a stubbed fetcher, assert the request `input.filters` matches the resolved override (not the constant).
- **Smoke / E2E**: `pnpm dev` + `cd web && pnpm dev`, change values in `/filter`, save; `RUN_ONCE=1 pnpm dev`; observe the GraphQL request body in pino logs reflects new IDs/postFilter cap.
- `pnpm typecheck && pnpm lint && pnpm test` all green.

## Risks / Open Questions

- **Mid-sweep filter mutation**: `runSweep` reads the filter once at sweep start (already does for settings), so a mid-sweep PUT affects the next tick only. Document this; do not try to live-swap.
- **Opaque 999.md option IDs**: locality / category enums in `src/types/filter.ts` are tied to the 999.md mapping table. If a value is added in UI but not in the mapping, `resolve()` should throw a typed `UnknownGenericFilterValueError`; surface to the API as 400. Don't let it silently drop.
- **Zod schema sharing across server / SPA**: simplest path is to duplicate the schema in `web/src/lib/filterSchema.ts`. Avoid building a workspace-shared package for one schema. Add a comment in both files referencing the canonical copy in `src/types/filter.ts`.
- **Backwards-compat with `data/.circuit_open` and `progress.md`**: untouched — this slice doesn't move sentinel paths or session files.
- **Migration ordering vs seed**: `prisma migrate deploy` doesn't run seed; document that production needs `pnpm prisma db seed` once after this lands, or wire the seed into `index.ts` boot (preferred — idempotent upsert keyed on `sourceId`).
- **Naming**: `FilterPreset` vs `ActiveFilter`. Recommend `FilterPreset` to leave room for the named-preset variant later, but use a `@unique sourceId` constraint now to enforce one-per-source.
- **`searchInput` shape stability**: `FILTER.searchInput` includes `source: 'AD_SOURCE_DESKTOP'` and pagination is added later by `buildSearchVariables`. The mapping `resolve()` must produce the same shape (sans pagination) — the parity test is what guards this.

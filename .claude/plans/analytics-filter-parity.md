# Plan: Analytics filter parity with Listings (dynamic)

> Source of truth: `docs/superpowers/specs/2026-05-10-analytics-filter-parity-design.md`
> This plan is the compact execution map; the design doc carries the full rationale and edges.

## Goal

Make the Analytics page surface at least the same filters as Listings (`q`, `maxPrice`, `district`) in addition to its existing analytics-specific filters (`type`, `rooms`, `period`), with all options sourced from observed data — no hardcoded option lists. Filters propagate to all three analytics endpoints so KPIs, charts, scatter, and tables reflect the slice.

## Acceptance Criteria

- [ ] `/api/listings/facets` response includes `types: string[]` and `roomsValues: number[]`, both derived from active listings.
- [ ] `/api/analytics/overview`, `/api/analytics/best-buys`, `/api/analytics/price-drops` each accept the unified query params: `q`, `maxPrice`, `district`, `type`, `rooms` (and `period` on price-drops). All KPIs/charts/tables reflect the filtered slice.
- [ ] The `region` query param is renamed to `district` on best-buys and price-drops. Legacy `region` is not relied on by the UI (server may silently ignore it).
- [ ] `web/src/components/analytics/types.ts` no longer exports `A_DISTRICTS`, `A_TYPES`, `A_ROOMS` (or keeps them as `[] as const` fallbacks only).
- [ ] `web/src/pages/Analytics.tsx` reads facets via `useQuery(['listings-facets'])` (same key as Listings) and feeds them into the rail; `q` and `maxPrice` are page-level state.
- [ ] A shared `<AnalyticsFilterRail>` replaces the three duplicated rail blocks in `Analytics.tsx`. Period selector slots in for the Price Drops tab only.
- [ ] All Gherkin scenarios in `specs/analytics-filter-parity.feature` (see design doc §"Acceptance criteria") have a passing `it()`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all green.

## Tasks (execution order — server before client per dependency-map)

1. **Shared util** — create `src/lib/listing-type.ts` exporting `deriveType(title)` and `roomsBucket(rooms)`. Move them out of `src/web/routes/analytics.ts`.
2. **Facets endpoint** — extend `/api/listings/facets` in `src/web/routes/listings.ts`: compute `types` (distinct `deriveType(title)`) and `roomsValues` (distinct non-null `rooms`, ascending). Add Vitest cases in `src/web/routes/__tests__/listings.test.ts`.
3. **Analytics endpoints** — add `parseAnalyticsFilters(c)` helper at top of `src/web/routes/analytics.ts` returning `{ q, maxPrice, district, type, rooms }`. Apply filters to the base `prisma.listing.findMany({ where })` in all three routes. For `q`, mirror `searchListings`' Prisma `where` shape; read `src/mcp/queries.ts` to copy the exact ILIKE pattern.
4. **Type filter post-fetch** — keep `deriveType` JS regex; drop listings whose derived type ≠ filter value before downstream aggregation. Document with one-line comment ("regex over title; SQL ILIKE is brittle for diacritics").
5. **Best Buys note** — add a code comment near district-median computation: "medians computed within filtered slice — discount is relative to that slice, intended."
6. **Tests for routes** — extend `src/web/routes/__tests__/analytics.test.ts`:
   - One `it()` per filter param × per route asserting the slice narrows.
   - One `it()` for combined `q + maxPrice + district` on `/analytics/overview` checking KPIs.
   - One `it()` confirming `?district=` works on best-buys/price-drops.
7. **Frontend util** — copy `roomsBucket` to `web/src/lib/listing-type.ts` (small enough to duplicate; the frontend has no shared package boundary today).
8. **Frontend filter rail** — add `<AnalyticsFilterRail>` in `web/src/components/analytics/filters.tsx`. Props: `{ q, setQ, maxPrice, setMaxPrice, district, setDistrict, type, setType, rooms, setRooms, facets, extraSlot? }`. Mirror Listings' Search input + Max price slider DOM/classes (`Listings.tsx:178-205`) for visual consistency.
9. **Frontend page** — in `web/src/pages/Analytics.tsx`:
   - Add `q` (string, default `''`) and `maxPrice` (number, defaults to facets.price.max).
   - Fetch facets with `useQuery(['listings-facets'], () => apiCall('/listings/facets'))`.
   - Replace each panel's inline rail with `<AnalyticsFilterRail facets={facets} ... />`.
   - Pass all filter values as query string on each `/analytics/*` call. Skip `maxPrice` when at facets max. Update query keys to include the filter object so changes refetch.
10. **Drop hardcoded constants — wider blast radius than expected.**
    - Remove `A_DISTRICTS`, `A_TYPES`, `A_ROOMS` exports from `web/src/components/analytics/types.ts`.
    - `Heatmap` consumes `A_DISTRICTS`+`A_ROOMS` to enumerate the grid → add `districts: string[]` and `roomBuckets: string[]` props.
    - `Legend` (in `filters.tsx`) consumes `A_DISTRICTS` → add `districts: string[]` prop.
    - `Analytics.tsx` passes `facets.districts` / facets-derived rooms buckets into both.
    - Keep `DIST_COLORS` (color map keyed by district name; extra entries are harmless, missing entries fall back to teal — out of scope to make dynamic).
11. **Frontend smoke test** — add `web/src/components/analytics/__tests__/AnalyticsFilterRail.test.tsx` (or extend an existing test): asserts options come from the `facets` prop and that the search input + slider call their setters.

## File Map

| Action | File                                                                        | Notes                                                  |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| create | `src/lib/listing-type.ts`                                                   | shared `deriveType`, `roomsBucket`                     |
| modify | `src/web/routes/listings.ts`                                                | extend `/facets` with `types`, `roomsValues`           |
| modify | `src/web/routes/analytics.ts`                                               | unified filter parsing + apply to all three routes     |
| modify | `src/web/routes/__tests__/listings.test.ts`                                 | cover new facet fields                                 |
| modify | `src/web/routes/__tests__/analytics.test.ts`                                | new filter param scenarios                             |
| create | `web/src/lib/listing-type.ts`                                               | frontend `roomsBucket` (small copy)                    |
| modify | `web/src/components/analytics/filters.tsx`                                  | new `<AnalyticsFilterRail>`                            |
| modify | `web/src/components/analytics/types.ts`                                     | drop hardcoded option arrays                           |
| modify | `web/src/pages/Analytics.tsx`                                               | lift state, wire facets, use shared rail               |
| create | `web/src/components/analytics/__tests__/AnalyticsFilterRail.test.tsx`       | rail smoke test                                        |
| create | `specs/analytics-filter-parity.feature`                                     | Gherkin (5 scenarios from design doc)                  |

## Verification

- `pnpm test src/web/routes/__tests__/listings.test.ts` — facets tests green.
- `pnpm test src/web/routes/__tests__/analytics.test.ts` — all filter scenarios green.
- `cd web && pnpm test` — frontend rail smoke test green.
- `pnpm typecheck && pnpm lint` — clean.
- Manual: `pnpm dev` + `cd web && pnpm dev` → open Analytics, confirm options match facets, search/max-price filter all panels.

## Out of scope (explicit)

- URL persistence of analytics filter state.
- Min-price / area-range filters (Listings rail doesn't expose them either).
- CSV export changes.
- Map / geo views.

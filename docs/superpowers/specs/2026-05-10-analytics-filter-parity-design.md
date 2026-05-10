# Analytics filter parity with Listings (dynamic, data-driven)

Date: 2026-05-10
Status: Approved (ready for plan)

## Problem

The Analytics page filter rail is hardcoded:

```ts
// web/src/components/analytics/types.ts
export const A_DISTRICTS = ['Buiucani', 'Botanica', 'Centru', 'Ciocana', 'Durlești', 'Râșcani'];
export const A_ROOMS = ['1–2', '3', '4', '5+'];
export const A_TYPES = ['House', 'Villa', 'Townhouse'];
```

Two issues with this:

1. **Drift.** Districts the crawler discovers (e.g. a new Chișinău suburb) never appear in the rail; districts that fall out of the catalog still appear and silently filter to zero rows.
2. **Filter gap with Listings.** Listings exposes **search (`q`)** and **max price** in addition to **district**, all sourced dynamically from `/api/listings/facets`. Analytics has none of these. A user filtering Listings cannot reproduce the same view in Analytics.

Additionally, the analytics `rooms` state in `Analytics.tsx` is set in the UI but never sent to the API, so the Rooms filter is decorative today.

## Goal

Analytics surfaces **at least the same filter set as Listings** (`q`, `maxPrice`, `district`) plus its existing analytics-specific filters (`type`, `rooms`, and `period` for price-drops). All filter options are sourced from observed data — no hardcoded option lists. All Overview / Best Buys / Price Drops panels respond to the full filter set, including KPIs, trend, heatmap, scatter, and tables.

## Non-goals

- No new chart types or analyses.
- No URL-state persistence of analytics filters (Listings doesn't persist its filters either, beyond sweep deep-links).
- No CSV export changes.
- No new map / geo views.

## Design

### 1. Facets endpoint — single source of truth

Reuse `/api/listings/facets` for both pages. Extend its response with two fields the analytics rail needs:

```ts
{
  total: number;
  districts: string[];          // existing
  price:    { min: number | null; max: number | null }; // existing
  rooms:    { min: number | null; max: number | null }; // existing
  areaSqm:  { min: number | null; max: number | null }; // existing
  types:        string[]; // NEW — distinct deriveType(title) values from active listings
  roomsValues:  number[]; // NEW — distinct rooms integers, ascending; UI buckets these for display
}
```

Why one endpoint, not a separate `/api/analytics/facets`: the filter universes must agree across pages or users see different option sets for the same underlying filter and lose trust in the data.

`types` is computed by running the existing `deriveType` over the title set (regex over title — see "Type filter" below). `roomsValues` is `SELECT DISTINCT rooms FROM listings WHERE active AND rooms IS NOT NULL ORDER BY rooms`.

### 2. Shared title-derivation util

Move `deriveType(title)` and `roomsBucket(rooms)` from `src/web/routes/analytics.ts` to a new `src/lib/listing-type.ts`. They are used by both the facets builder and analytics endpoints.

```ts
// src/lib/listing-type.ts
export function deriveType(title: string): 'House' | 'Villa' | 'Townhouse' { ... }
export function roomsBucket(rooms: number | null): '1–2' | '3' | '4' | '5+' { ... }
```

Frontend imports `roomsBucket` from a parallel `web/src/lib/listing-type.ts` (or duplicates the small function — the frontend is a separate package, no shared lib today).

### 3. Analytics endpoints accept unified filter set

All three analytics routes accept the same query parameter set (renamed for consistency with Listings):

| Param      | Type     | Notes                                                                   |
| ---------- | -------- | ----------------------------------------------------------------------- |
| `q`        | string   | Case-insensitive match on `title` OR `district` (mirrors `searchListings`). |
| `maxPrice` | number   | Filter `priceEur <= maxPrice`. Omitted when slider at facets max.       |
| `district` | string   | Exact match (was `region` in best-buys/price-drops — renamed).          |
| `type`     | enum     | `House` \| `Villa` \| `Townhouse`. Filter via `deriveType` post-fetch.  |
| `rooms`    | number   | Single rooms count (e.g. `3`). UI sends from observed `roomsValues`.    |
| `period`   | enum     | `7d` \| `30d` \| `90d`. **Price-drops only.**                           |

Filters apply at the base `prisma.listing.findMany({ where })` so KPIs, district medians, scatter, trend buckets, heatmap, and tables all see the same slice.

**Naming.** `region` → `district` is a breaking rename of the analytics query string only. There are no external consumers; the operator UI is the only caller. The migration is a single commit.

**Implementation notes per route:**

- `/analytics/overview` — apply filters to the `active` listing set before computing `medianEurPerSqm`, `domBuckets`, `trendByDistrict`, `heatmap`, `scatter`, `bestDealsCount`, and `recentDropsCount`. The price-drop count's secondary `findMany` (with `snapshots`) takes the same `where`.
- `/analytics/best-buys` — district medians and z-scores are computed **within the filtered slice**. This is the intended behavior: "best buy in this filtered universe", not "best buy globally". Document this in a code comment.
- `/analytics/price-drops` — straightforward addition of new params to the existing `where` and post-fetch filtering.

**Type filter — why post-fetch.** `deriveType` is a JS regex over title (`/vil[ăa]/i`, `/townhouse/i`). Translating to SQL `ILIKE` patterns is brittle (Romanian diacritics, regex anchors). Cost: one extra in-memory filter pass per request, on at most ~few-thousand active listings. Acceptable.

**`q` matching.** Mirror `searchListings` (already implemented for `/api/listings`). Read its current semantics in `src/mcp/queries.ts` and reuse the same Prisma `where` clause shape.

### 4. Frontend — Analytics.tsx

**State.** Lift to page level (already there for region/type/rooms); add `q` (string) and `maxPrice` (number, defaults to facets max).

**Facets.** `useQuery(['listings-facets'])` — same query key as Listings. React Query dedupes the request, so navigating between pages doesn't re-fetch.

**Replace hardcoded constants.** Drop the `A_DISTRICTS` / `A_TYPES` / `A_ROOMS` imports. Source from `facets.districts`, `facets.types`, and `facets.roomsValues.map(roomsBucket)` (deduped). Keep a fallback empty array while loading.

**Query keys.** Each `useQuery` for analytics data includes the full filter set in its key, so charts refetch on filter change:

```ts
useQuery({
  queryKey: ['analytics', 'overview', { q, maxPrice, district, type, rooms }],
  queryFn: () => apiCall(`/analytics/overview?${buildParams(...)}`),
});
```

**Shared filter rail.** Extract `<AnalyticsFilterRail>` since the rail is currently duplicated across `OverviewPanel`, `BestBuysPanel`, `PriceDropsPanel`. The component takes the filter values + setters and an optional `extraSlot` for the Period selector on Price Drops.

```tsx
<AnalyticsFilterRail
  q={q} setQ={setQ}
  maxPrice={maxPrice} setMaxPrice={setMaxPrice}
  district={district} setDistrict={setDistrict}
  type={type} setType={setType}
  rooms={rooms} setRooms={setRooms}
  facets={facets}
  extraSlot={tab === 'price-drops' ? <PeriodSegment ... /> : null}
/>
```

The Search input and Max price slider mirror the Listings rail visually (same components: `<Input>`, `<input type="range" className="accent-accent">`).

### 5. Tests

- **Backend.** Extend `src/web/routes/__tests__/analytics.test.ts`:
  - One scenario per filter param × per route (q, maxPrice, district, type, rooms) verifying the filter narrows the result set as expected.
  - One scenario for the renamed param: `?district=` works on best-buys/price-drops; `?region=` is no longer accepted (or is silently ignored — pick: ignore for forgiveness).
  - One scenario for filter combinations (q + maxPrice + district) on overview, asserting KPIs reflect the slice.
- **Backend facets.** Add a `listings-facets` test asserting `types` and `roomsValues` are present and sorted.
- **Frontend.** Add a smoke render test for `<AnalyticsFilterRail>` that asserts: (a) options come from the facets prop, not hardcoded constants; (b) typing in Search calls `setQ`; (c) moving the price slider calls `setMaxPrice`.

Per project rules (`tdd-workflow.md`, `framework-boundary.md`): RED before GREEN, integration > unit, mock `undici` (not relevant here — no fetches), Postgres via testcontainers per file (already the pattern in `analytics.test.ts`).

### 6. Edge cases

- **Empty catalog (fresh DB).** Facets returns empty arrays + `null` price min/max. Rail renders with empty district list and a `0–250000` slider fallback (same as Listings). All analytics routes return their existing empty-state shapes.
- **`maxPrice` at slider max.** Don't send the param — avoids a spurious filter and matches Listings' behavior at `Listings.tsx:108`.
- **Type filter sees no matches.** Return empty arrays / zeroed KPIs; UI shows the existing "no rows" states.
- **Rooms values that don't bucket cleanly.** Today `roomsBucket` maps `null → '1–2'`; preserve that behavior. UI sends raw integer; server applies exact match.
- **Best Buys discount semantics under filters.** District median is recomputed within the filtered slice — a code comment makes the intent explicit so a future reader doesn't "fix" it back to global.

## Files touched

| File                                                  | Change                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `src/lib/listing-type.ts` (new)                       | `deriveType`, `roomsBucket` shared helpers                       |
| `src/web/routes/listings.ts`                          | Extend facets response with `types`, `roomsValues`              |
| `src/web/routes/analytics.ts`                         | Accept `q`/`maxPrice`/`district`/`type`/`rooms` on all 3 routes |
| `src/web/routes/__tests__/listings.test.ts`           | Cover new facet fields                                          |
| `src/web/routes/__tests__/analytics.test.ts`          | Cover new filter params + combinations                          |
| `web/src/lib/listing-type.ts` (new)                   | Frontend copy of `roomsBucket` (small enough to duplicate)      |
| `web/src/pages/Analytics.tsx`                         | Lift `q`/`maxPrice` state, wire facets, pass filters to queries |
| `web/src/components/analytics/filters.tsx`            | New `<AnalyticsFilterRail>` component                           |
| `web/src/components/analytics/types.ts`               | Remove `A_DISTRICTS`/`A_TYPES`/`A_ROOMS` exports                |
| `specs/analytics-filter-parity.feature` (new)         | Gherkin spec, one scenario per acceptance criterion             |

## Acceptance criteria (Gherkin sketch)

```gherkin
Feature: Analytics filter parity with Listings

  Scenario: Filter rail offers the same filters as Listings
    Given the Analytics page is open
    Then the filter rail shows Search, Max price, District, Property type, Rooms
    And on the Price drops tab a Period selector also appears

  Scenario: Filter options come from observed data
    Given the catalog has districts ["Centru","Botanica"] and types ["House","Villa"]
    When I open Analytics
    Then the District list is exactly ["Centru","Botanica"]
    And the Property type list is exactly ["House","Villa"]
    And the hardcoded A_DISTRICTS / A_TYPES / A_ROOMS constants are not used

  Scenario: Search filter narrows KPIs and tables
    Given listings include "Casa Centru" and "Vila Botanica"
    When I type "Centru" in Search
    Then Overview KPIs reflect only the matching listings
    And Best Buys / Price Drops tables only contain matching rows

  Scenario: Max price filter applies to all analytics endpoints
    Given listings range from €50k to €500k
    When I drag Max price to €200k
    Then /analytics/overview, /analytics/best-buys, /analytics/price-drops all see priceEur <= 200000

  Scenario: District filter param is named "district" everywhere
    When the UI requests /analytics/best-buys?district=Centru
    Then the response is filtered to district=Centru
    And requests using legacy ?region= are not relied on by the UI
```

## Risks

- **Best Buys score interpretation drift.** Computing district medians within the filtered slice changes the meaning of "discount vs median" when a user narrows by `q` or `maxPrice` — the comparison becomes "discount vs filtered-slice median". Document this; do not silently fall back to global medians.
- **Performance.** The overview route already loads all active listings; adding filter params doesn't change the query shape. Type filter is post-fetch JS — O(n) over a small set. No new N+1.
- **999.md drift memory (2026-05-09).** This change does not touch `999.md` filter IDs or the smoke test config — independent of that drift.

## Out of session

- Future: persist analytics filter state in URL (`?district=…&q=…`) so views are shareable. Not in scope here; would unlock saved-view feature.
- Future: extend filter set with min/max area and rooms range to fully match facets. Out of scope (Listings itself doesn't expose min-price or area filters in the rail today).

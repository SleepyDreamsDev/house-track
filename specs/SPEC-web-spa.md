# Operator SPA (React + Tailwind) — Specification

## Purpose & Scope

The Operator SPA is a Vite + React 18 + TypeScript SPA frontend, served from the main Hono API server, that provides an operator interface for browsing, filtering, and analyzing property listings gathered by the crawler. It exposes six main pages (Dashboard, Listings, Sweeps, Filter, Analytics, Settings) beneath a collapsible sidebar navigation, with TanStack Query caching, session-scoped filter persistence, and client-side table sorting. The SPA consumes the `/api/*` routes documented in `docs/operator-ui.md` and enforces data-driven filter visibility (show options only when the catalog has data).

## Architecture & Key Modules

| File Path                                                               | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/App.tsx`                                                       | QueryClientProvider + RouterProvider root; entry point for router and caching setup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `web/src/router.tsx`                                                    | React Router v6 configuration; defines all 8 routes under AppShell layout (Dashboard, Listings, ListingDossier `/listings/:id`, Sweeps, SweepDetail, Filter, Analytics, Settings).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `web/src/components/layout/AppShell.tsx`                                | Collapsible sidebar nav with icon + label pairs; toggles stored in `localStorage['appshell:nav-collapsed']`; renders `<Outlet>` for page content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `web/src/pages/Dashboard.tsx`                                           | Overview KPIs (inventory, new-today, price drops), sweep status, circuit-breaker state, success-rate card; uses `/listings/{endpoint}`, `/stats/*`, `/sweeps/latest`, `/circuit` APIs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `web/src/pages/Listings.tsx`                                            | Paginated (PAGE_SIZE=50), multi-view (cards/table) property browser; integrates FilterRail + useBrowseFilters hook; table renders ListingsTable with sortable columns + row-action buttons (favorite/exclude/open).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `web/src/pages/ListingDossier.tsx`                                      | Per-listing negotiation dossier at `/listings/:id`: header with external 999.md link, KStat tiles (price, €/m², DOM vs district median, hedonic residual), PriceHistoryPanel, description, Same-seller and Duplicates/relists cards; fetches `/listings/:id` + `/listings/:id/dossier`; 404 → "Listing not found" card. Linked from Listings titles and analytics View → actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `web/src/pages/Sweeps.tsx`                                              | Table of recent SweepRun rows; filters by source; navigates to SweepDetail on click.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `web/src/pages/SweepDetail.tsx`                                         | Single sweep inspection; expands status, page/detail counts, error log.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `web/src/pages/Filter.tsx`                                              | Dynamically rendered filter-taxonomy editor using FilterForm + GenericFilter types; fetches `/sources/{id}/taxonomy` and `/settings` and `POST`s to respective endpoints.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `web/src/pages/Analytics.tsx`                                           | Three-tab layout (Overview, Best Buys, Price Drops); each tab shares FilterRail; Overview renders KPI cards + time-series chart; Best Buys/Price Drops render sortable BestBuysTable/PriceDropsTable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `web/src/pages/Settings.tsx`                                            | Operator config: politeness, cron schedule, source enable/disable; fetches `/settings` with namespaced keys (`politeness.baseDelayMs`, `sweep.*`, etc.); `PUT`s edits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `web/src/components/filters/FilterRail.tsx`                             | Unified reusable browse-filters sidebar for Listings & Analytics; renders search input, range fields (price, area, land, floors), multi-select groups (Locality/districts, sectors), single-select groups (type, rooms), boolean toggles (favorites, excluded, mislabeled); an optional "Clear all" button (shown only when `onClearAll` provided AND any filter is active). Visibility gating: ranges shown only when `hasRange()` (bounds non-null AND `max > min`); Locality/Sector when option list non-empty; Property type only when `types.length > 1`; Rooms when ≥1 bucket; favorites/excluded/mislabeled toggles only when the matching facet count > 0. The Hide-mislabeled toggle is Listings-only (rendered only when `setHideMislabeled` prop is passed). RangeField inputs reject blank/NaN/negative values (coerced to null). |
| `web/src/components/filters/FilterForm.tsx`                             | Dynamic form renderer for the Filter page; consumes TaxonomyEntry[] (filterId/label/kind/"options"/"range"/"boolean"); state lifted to parent; onChange bubbles up as GenericFilter updates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `web/src/components/filters/FilterSection.tsx`                          | Accordion header + content for a single filter group; shows selection count badge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `web/src/components/filters/{OptionsField,RangeField,BooleanField}.tsx` | Reusable input components for filter options checkboxes, min/max range inputs, and boolean toggles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `web/src/components/listings/ListingsTable.tsx`                         | Sortable table for property rows (title, district, price, €/m², area, rooms, land, first-seen); uses useSortableTable hook; column click toggles sort; final column holds action buttons (favorite/exclude/open).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `web/src/components/listings/PriceHistoryPanel.tsx`                     | Expanded row detail showing price-change history (priceEur, direction ▲▼, deltaPct, date); fetched on demand from `/listings/{id}/price-history`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `web/src/components/listings/RowActions.tsx`                            | Row action button group: favorite toggle (★/☆), exclude button (✕), and external link to 999.md.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `web/src/components/analytics/tables.tsx`                               | BestBuysTable and PriceDropsTable; share sorting/ranking UI; render ScoreBar (for best-buys) + badges (for drops).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `web/src/components/analytics/filters.tsx`                              | Analytics-specific UI: Segmented sort/period picker, district color legend (DIST_COLORS map).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `web/src/lib/api.ts`                                                    | Simple fetch wrapper; `apiCall<T>(endpoint, options?)` prefixes `/api` and parses JSON.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `web/src/lib/query.ts`                                                  | TanStack Query client with 5-min staleTime, 10-min gcTime defaults.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `web/src/lib/useBrowseFilters.ts`                                       | Custom hook managing filters shared across Listings & Analytics: q, price/area/land/floors ranges (null = unbounded), districts/sectors/type/rooms selectors, favorite/excluded/mislabeled toggles. Persists to `sessionStorage['house-track:browse-filters']` (whole-snapshot write on every change via useEffect), reads on mount (lazy). `setDistricts`/`setSectors` de-dupe via `Array.from(new Set(next))` so duplicate chips can't reach a SQL `IN`. Exposes `clearAll()` resetting every field to default.                                                                                                                                                                                                                                                                                                                             |
| `web/src/lib/useSortableTable.ts`                                       | Generic table sort hook; accepts rows + accessors; returns sortedRows, sortKey, sortDir, requestSort callback. Nullish values always appear at the end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `web/src/lib/format.ts`                                                 | Formatters: `fmt.eur(n)` (€ currency), `fmt.rel(isoDate)` (relative time), `fmt.date(isoDate)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `web/src/lib/listing-type.ts`                                           | Type derivation; `roomsBucket(count)` → '1–2'/'3'/'4'/'5+'.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `web/src/lib/filterSchema.ts`                                           | Zod schemas: `GenericFilter` = `{ category: 'house'\|'apartment', filters: FilterSelection[] }` (NO name/description fields); `FilterSelection` discriminated union (options/range/boolean) with runtime invariants (options require ≥1 id; range requires ≥1 of min/max and min≤max). Mirror of server `src/types/filter.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `web/src/lib/sse.ts`                                                    | `useSse<T>(url, enabled)` EventSource hook — live sweep streaming. Subscribes to `/api/sweeps/{id}/stream` when `enabled` (sweep status==='running'); appends parsed JSON events, ignores malformed, lets EventSource auto-reconnect on error, closes on unmount/disable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `web/src/components/ui/*`                                               | Tailwind v4 component primitives: Card, Button, Badge, Input, KStat, Sparkline, StatusDot, ListingThumb, PageHeader, SectionHeader, SortableTh.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Data Flow / Control Flow

### Listings Page (Browse)

1. **Mount**: useBrowseFilters reads sessionStorage at init (lazy); Listings page fetches `/listings/facets` once to populate FilterRail options.
2. **Operator interaction**: User adjusts search (q), ranges (price/area/land/floors), or selectors (district/sector/type/rooms/favorite/excluded/mislabeled).
3. **useBrowseFilters hook**: Each setter (setQ, setMinPrice, …) updates component state **and** writes the entire BrowseFilterState to sessionStorage (on every change). This persists filters across page switches without round-trips.
4. **Server call (debounced in Listings)**: When filters change, Listings constructs a query string `?q=…&minPrice=…&maxPrice=…&…&page=0` and calls `GET /listings?…`. TanStack Query caches under key `['listings', { q, minPrice, … }]`.
5. **Response**: `/listings` endpoint returns paginated array of Listing rows + total count. On filter change, page resets to 0.
6. **Render**: ListingsTable sorts client-side by the current sort key (default: firstSeenAt desc); sortedRows are built by useSortableTable. Row click selects a listing and renders PriceHistoryPanel below (expandable row).
7. **Row actions**: Favorite/exclude buttons trigger `PUT /listings/{id}/watchlist` (body `{ watchlist }`) or `PUT /listings/{id}/excluded` (body `{ excluded }`); optimistic update + refetch via useMutation + queryClient.invalidateQueries.
8. **Session persistence**: Switching to Analytics and back to Listings restores the same filter state + page number (from sessionStorage), avoiding filter reset.

### Analytics Page (Multi-Tab)

1. **Mount**: Fetches `/listings/facets` (same cache key as Listings). Four tabs (Overview, Best Buys, Price Drops, Motivated Sellers) share the same FilterRail instance.
2. **Tab-specific endpoints**: Overview → `/analytics/overview?…`, Best Buys → `/analytics/best-buys?…`, Price Drops → `/analytics/price-drops?…`; all accept the same filter query string (q, minPrice, maxPrice, district, type, rooms, etc.).
3. **Overview tab**: Renders KPI cards (`medianEurPerSqm`, `activeInventory`, `medianDomDays`, `bestDealsCount`, `recentDropsCount`) plus several charts driven by the OverviewResponse: MultiLineChart (`trendByDistrict`/`months`), Heatmap, DOMHistogram (`domBuckets`), a FlowChart (`inventory12w`/`newPerWeek`/`gonePerWeek`), and a Scatter (`scatter`). A district color Legend (`DIST_COLORS`, fallback `#0f766e`) keys the charts. Fetches `/analytics/overview?…` with current filters.
4. **Best Buys tab**: Table showing ranked properties by score (computed server-side as a weighted combo of discount vs. median €/m², days-on-market, price drop flag). Sortable columns; default sort by score desc. Includes Segmented buttons for quick sort presets (Score, €/m², Discount).
5. **Price Drops tab**: Similar table; rows filtered to only listings with observed price changes. Segmented Period picker (7d/30d/all) controls the time window for drop detection.
   5b. **Motivated Sellers tab** (`?tab=motivated-sellers`): Table ranked by a server-side composite of overexposure (DOM vs in-slice district DOM median), capitulation (observed cuts + all-time first-ask→current cut), and overpricing (hedonic residual > +10%). Lazy-fetched only when active. `residualPct` renders as em dash when the hedonic floor (n<10) isn't met. Sort presets: Score, DOM, Cuts, vs model. Rows carry watchlist/exclude actions and a View → `/listings?highlight=<id>&from=motivated-sellers` jump; Listings shows a matching back link.
6. **Shared filter behavior**: All tabs request data with the same query string; facets update together. If Listings has 10 districts but one is filtered out in Analytics, the facets still show both (facets = union of catalog data, not post-filter).

### Filter Editor Page

1. **Mount**: Fetches `/sources` (list of Source rows) and `/settings` (Setting KV map). For each source with adapterKey='999md', fetches `/sources/{id}/taxonomy` (TaxonomyEntry array).
2. **Render FilterForm**: Given TaxonomyEntry[] (with filterId, label, kind='options'/'range'/'boolean', features=[{ featureId, label, unit?, units?, options? }]), dynamically renders sections and input components. State is a GenericFilter: `{ category, filters: FilterSelection[] }` (no name/description). A `FilterSection` opens by default when its selection count > 0, and shows a count badge summing optionIds + each active boolean/range.
3. **Operator edits**: Checkbox/range/text inputs toggle FilterSelection items. `toggleOption` removes the options selection entirely when its last id is unchecked; `updateRange` removes the range selection when both min and max become empty; multi-unit pickers track the chosen unit in `pendingUnits[filterId:featureId]` until a min/max creates the selection, after which the unit lives on the selection. On save, `PUT /sources/{id}/filter` with the edited GenericFilter JSON.
4. **Post-save**: Crawler reads the filter from Postgres on next sweep-start via getSetting('sources.{sourceId}.filter'). No hot-reload; operator must manually trigger a sweep or wait for the next cron job.

### Settings Page

1. **Mount**: Fetches `/settings` and `/sources`.
2. **Render**: Grouped control panels for politeness (baseDelayMs, jitterMs, detailDelayMs), cron schedule, circuit-breaker status, source enable/disable.
3. **Operator edits**: Text inputs, number inputs, toggles. On blur or explicit Save, `PUT /settings` with the modified Setting key-value map.
4. **Circuit breaker**: Shows current state (open/closed) + lastTriggered time. Manual "Clear" button calls `DELETE /circuit`.

### Sweep Execution & Status

- **Sweeps page**: Lists recent SweepRun rows (status, startedAt, finishedAt, pagesFetched, detailsFetched, newListings, errors). Polled every 5–10s via `/sweeps?limit=20` query with `staleTime: 0` to always refetch.
- **SweepDetail page**: Single sweep expansion; shows configSnapshot (filter + politeness at time of sweep), pagesDetail (per-page fetch results), detailsDetail (per-listing detail fetch results), eventLog (low-level trace).
- **Dashboard status**: Displays latestSweep (running/success/failed) + circuit state + success rate (ok/total over the last N days).
- **Dashboard staleness banner**: Above the KPI strip, driven by `/sweeps/latest` (`finishedAt ?? startedAt`). Error banner when the latest sweep `status === 'failed'`; warning banner when the latest sweep is not running and ended more than `STALE_SWEEP_THRESHOLD_MS` (24h, hardcoded client const — cadence is a few sweeps/day, so 24h means at least two missed sweeps) ago. Both link to `/sweeps`. No banner while a sweep is running (a long-overdue sweep that just started shouldn't warn) or when no sweep exists yet (fresh DB / query error — first-boot stays clean).

## Contracts & Types

### Request/Response Interfaces

**GET /api/listings** → `{ rows: Listing[], total: number }`

- Query: `q, minPrice, maxPrice, minArea, maxArea, minLand, maxLand, minFloors, maxFloors, districts[], sectors[], type, rooms, favoritesOnly, showExcluded, hideMislabeled, page, limit`
- Listing shape: id, url, title, priceEur, areaSqm, landAre, rooms, district, sector, firstSeenAt, watchlist, excluded, derivedType, typeMismatch, regionMismatch, mismatchReasons, primaryImage, flags, isNew

**GET /api/listings/facets** → `{ districts: string[], municipality?: string[], sectors?: { name, count }[], types: string[], roomsValues: number[], price: { min, max }, areaSqm?: { min, max }, landAre?: { min, max }, floors?: { min, max }, favoritesCount?, excludedCount?, mislabeledCount?, total: number }`

- Drives FilterRail option lists and visibility (no options = hide filter group).

**GET /api/listings/{id}/price-history** → `{ points: { priceEur, capturedAt, deltaPct, direction: 'up'|'down'|'baseline' }[] }`

**PUT /api/listings/{id}/watchlist** → `{ success: boolean }`

- Body: `{ watchlist: boolean }`

**PUT /api/listings/{id}/excluded** → `{ success: boolean }`

- Body: `{ excluded: boolean }`

**GET /api/analytics/overview** → `OverviewResponse` (see `web/src/components/analytics/types.ts`)

- `kpis`: `{ medianEurPerSqm, activeInventory, medianDomDays, bestDealsCount, recentDropsCount }` — NOT `totalInventory/newToday/avgPriceEur`.
- Plus: `trendByDistrict: Record<string, number[]>`, `months: string[]`, `heatmap: Record<string, Record<string, number>>`, `domBuckets: { label, count, hot?, stale? }[]`, `inventory12w: number[]`, `newPerWeek: number[]`, `gonePerWeek: number[]`, `scatter: { id, areaSqm, priceK, district }[]`. (Renders MultiLineChart, Heatmap, DOMHistogram, FlowChart, Scatter — not a single sparkline.)

**GET /api/analytics/best-buys** → `{ rows: BestBuyRow[], ... }`

- BestBuyRow: id, url, title, type, district, priceEur, areaSqm, yearBuilt, daysOnMkt (in HOURS — rendered `${n}h` when <24 else `${n/24}d`), eurPerSqm, medianEurPerSqm, discount (% vs median), z, score (0–3 scale; ScoreBar clamps to [0,3]), priceDrop, dropPct, rooms, watchlist?, excluded?

**GET /api/analytics/price-drops** → `{ rows: PriceDropRow[], ... }`

- PriceDropRow: id, url, title, type, district, priceWas, priceEur, dropPct, dropEur, when (string; sorted via `parseInt(when, 10)`)

**GET /api/sources** → `{ sources: Source[] }`

- Source: id, slug, name, baseUrl, adapterKey, enabled, politenessOverridesJson, filterOverridesJson, createdAt, updatedAt

**GET /api/sources/{id}/taxonomy** → `{ entries: TaxonomyEntry[] }`

- TaxonomyEntry: filterId, label, kind ('options'|'range'|'boolean'), features: [{ featureId, label, unit?, units?, options?: [{ id, label }] }]

**GET /api/settings** → `{ settings: { key: string, valueJson: any }[] }`

**PUT /api/settings** → `{ success: boolean }`

- Body: `{ key: string, valueJson: any }[]`

**PUT /api/sources/{id}/filter** → `{ success: boolean }`

- Body: GenericFilter `{ category: 'house'|'apartment', filters: FilterSelection[] }`. Server re-validates via `genericFilterSchema.parse` — a missing/invalid category, an empty `optionIds`, or a range with no bound / min>max is rejected with a ZodError (HTTP 4xx).

**GET /api/sweeps/{id}/stream** → Server-Sent Events stream

- Each `message` event carries a JSON-encoded sweep event. Consumed by `useSse` on the SweepDetail page only while the sweep `status === 'running'`. EventSource auto-reconnects on transient errors; malformed payloads are dropped silently.

**GET /api/sweeps** → `{ rows: SweepRun[], total: number }`

- Query: `?limit=20&offset=0&source=999md`
- SweepRun: id, startedAt, finishedAt, status, pagesFetched, detailsFetched, newListings, updatedListings, errors, source, trigger, kind, configSnapshot, pagesDetail, detailsDetail, eventLog

**GET /api/sweeps/latest** → `{ status: 'running'|'success'|'failed'|'cancelled', durationMs: number, startedAt: string }`

**GET /api/sweeps/{id}** → Full SweepRun detail

**DELETE /api/circuit** → `{ success: boolean }`

**GET /api/circuit** → `{ open: boolean, lastTriggeredAt?: string }`

### Type Definitions (Client-Side)

```typescript
// hooks/useBrowseFilters
export interface BrowseFilterState {
  q: string;
  minPrice: number | null; // null = unbounded
  maxPrice: number | null;
  minArea: number | null;
  maxArea: number | null;
  minLand: number | null;
  maxLand: number | null;
  minFloors: number | null;
  maxFloors: number | null;
  districts: string[]; // empty = all
  sectors: string[];
  type: string; // 'all' | derived type
  rooms: string; // 'all' | rooms bucket
  favoritesOnly: boolean;
  showExcluded: boolean;
  hideMislabeled: boolean;
}

// lib/filterSchema.ts (Zod + runtime inference) — mirror of server src/types/filter.ts
export const CATEGORIES = ['house', 'apartment'] as const;
export type GenericFilter = {
  category: 'house' | 'apartment'; // NOT name/description — those do not exist
  filters: FilterSelection[];
};
export type FilterSelection =
  | { kind: 'options'; filterId: number; featureId: number; optionIds: number[] } // optionIds.min(1) enforced
  | {
      kind: 'range';
      filterId: number;
      featureId: number;
      min?: string;
      max?: string;
      unit?: string;
    }
  | { kind: 'boolean'; filterId: number; featureId: number };
// Zod superRefine on the range variant: at least one of {min,max} required, and
// when both present Number(min) ≤ Number(max). Violations raise a ZodError on parse.
```

## Invariants & Business Rules

1. **Filter persistence is session-scoped, not browser-scoped**: useBrowseFilters uses sessionStorage, not localStorage. Filters survive a page reload within the tab but are cleared when the tab closes.
2. **Nullish values always sort to the end**: The useSortableTable hook ensures rows with null/undefined values in the active sort key appear last, regardless of sort direction (asc/desc). This prevents null prices from appearing at the top of a price-ascending sort. **First click on a fresh column always sorts ascending** (then toggles asc↔desc on repeat clicks of the same key). Numeric values compare numerically; string values use `localeCompare(…, { numeric: true, sensitivity: 'base' })` (natural, case-insensitive ordering). In **controlled** mode (`controlled` prop set, used by analytics tables) the hook does not own state — it reflects the prop and reports changes via `onSortChange`.
3. **Facets are union-of-catalog, not post-filter**: When the operator has a filter applied, the facets still list ALL observed values in the full catalog, not just the filtered slice. This lets the operator explore dimensions they've ruled out without hitting the API.

3a. **Filter-group visibility is per-group gated, not a single rule** (`FilterRail.tsx`):

- Range groups (Price/Surface/Land/Floors) show only when `hasRange(bounds)` is true: bounds non-null AND `max > min`. A single-valued facet (`min === max`) hides the group — so **Price is NOT always visible**.
- Locality and Sector show only when their option list is non-empty.
- **Property type shows only when `types.length > 1`** (a single observed type is not worth narrowing).
- Rooms shows only when ≥1 bucket is backed by data.
- Favorites / Show-excluded / Hide-mislabeled toggles each show only when the matching facet count (`favoritesCount` / `excludedCount` / `mislabeledCount`) > 0; Hide-mislabeled additionally requires the `setHideMislabeled` prop (Listings-only).
- Search is the only always-on control.

3b. **District/sector de-dupe at the setter**: `setDistricts`/`setSectors` wrap input in `Array.from(new Set(...))`, so any entry point (group "select all", paste, hydration) cannot produce duplicate chips.

3c. **Score scale is 0–3**: `ScoreBar` clamps the best-buy score to `[0, 3]` and renders the bar fill as `score/3`. Scores outside that band saturate the bar. 4. **Range filters default to null (unbounded)**. An empty input field = null, which means "no constraint." The URL omits the param entirely (e.g., no `minPrice=` if the operator hasn't set a minimum). 5. **Multi-unit ranges track unit in pending state**: When a RangeField with multiple units (e.g., price can be EUR/USD/MDL) is first opened, the unit is stored in pendingUnits local state until a min/max value is entered. Once a value exists, the unit moves to the FilterSelection.unit field. 6. **Sorting is client-side only**: Once a page of rows is fetched, useSortableTable sorts them locally. No round-trip to the server. Changing sort order within a page is instant. 7. **Watchlist and excluded are independent flags**: A row can be neither (default), watchlist-only, excluded-only, or both (edge case). The UI allows independent toggling. 8. **Type derivation is heuristic, read-only**: The derivedType (House/Villa/Townhouse/Duplex) is computed from the listing title server-side and cannot be edited in the SPA. A typeMismatch badge indicates when the crawler detected a likely mislabel. 9. **Analytics filters apply uniformly**: The same query string (q, price, district, type, rooms, etc.) is sent to all three analytics endpoints (/overview, /best-buys, /price-drops). No per-tab filter customization. 10. **Circuit-breaker state is persistent**: Shown on Dashboard and Settings; manual reset via DELETE /circuit clears the `data/.circuit_open` file on the crawler. 11. **Settings are namespace-keyed**: Every setting is stored with a dot-separated key (e.g., `politeness.baseDelayMs`, `sweep.cronSchedule`, `sources.999md.filterOverrides`). Client never uses object nesting; always array of KV pairs.

## Edge Cases & Failure Modes

1. **Empty catalog (zero listings)**:
   - Facets endpoint returns empty district/type/rooms arrays, null price bounds.
   - FilterRail hides all filter groups (gated on `hasRange(facets?.price)` etc.).
   - Analytics pages still render with empty KPI cards and empty tables.
   - No crash; graceful degradation.

2. **Network error on facets fetch**:
   - FilterRail still renders Search input; all other groups hidden.
   - User can type in search but cannot apply other filters until facets load.
   - Query auto-retries with TanStack Query's built-in backoff.

3. **Stale price-history data**:
   - PriceHistoryPanel caches with staleTime=5min. If the operator re-expands the same row within 5 min, cached data is used.
   - After 5 min, next expansion triggers a fresh fetch.

4. **Sort column with all nulls**:
   - Rows maintain input order; no visual sort indicator (requestSort still fired, but all rows look equal).

5. **Missing `sectors` in facets response**:
   - Type assertion `facets?.sectors ?? []` prevents crash; sector filter is simply not shown.

6. **Invalid UUID in URL** (e.g., `/sweeps/abc`):
   - SweepDetail page calls GET `/sweeps/abc`, which returns 404.
   - Page shows error state (network error card).

7. **Setting key doesn't exist** when operator edits:
   - `PUT /settings` with a new key creates it (upsert semantics).
   - No validation; server accepts any JSON value. Garbage-in → crawler may fail on next sweep.

8. **Favorite/exclude toggle fails**:
   - Optimistic update rolls back on error.
   - User sees error toast (toast UI not detailed in spec; assume standard error boundary).
   - Retry button available in error state.

9. **Analytics Best Buys / Price Drops tables with zero rows**:
   - Empty table; message "No results" shown.
   - User can adjust filters to populate.

10. **Mislabeled badge on rows that look correct**:
    - Heuristic may flag a legitimate house listing if its title doesn't match derived-type parser.
    - "Hide mislabeled" toggle lets user suppress these false-positives from view.

11. **Price history with ≤1 point**:
    - `PriceHistoryPanel` renders "No price changes recorded yet." when `points.length <= 1` (a baseline-only listing). The change list renders only for ≥2 points.
    - Points are rendered newest-first (`[...points].reverse()`). The baseline point shows "first seen"; up/down rows show `▲`/`▼` + `deltaPct.toFixed(1)%` (deltaPct is non-null for non-baseline points; baseline deltaPct may be null and is never dereferenced).

12. **Browser storage unavailable (AppShell)**:
    - All `localStorage` reads/writes for `appshell:nav-collapsed` are wrapped in try/catch. If storage throws (private mode, disabled), the collapse state degrades to in-memory only — no crash, but it won't persist across reload. Un-collapsing writes `'0'` (not just removing the key).

13. **Invalid GenericFilter on save**:
    - The save path parses the draft through `genericFilterSchema`. An empty `optionIds`, a range with neither min nor max, a range with min>max, or a missing/invalid `category` raises a ZodError before the PUT — the operator sees a validation error rather than persisting a malformed filter.

14. **Out-of-region listing badge**:
    - When `regionMismatch` is true, the listings table renders an `Out-of-region: {district}` warning badge (distinct from the type-mismatch badge). `NEW` and price-drop (`−{drop}%`, computed from `priceWas`) badges also render inline in the Title cell.

## Configuration & Operational Notes

### Environment

- **Frontend**: Served from the same Hono server at `/` (SPA) and `/api/*` (routes). Vite dev server proxies to `localhost:3000` (configurable in vite.config.ts).
- **Browser storage**: sessionStorage for filter persistence; localStorage for AppShell nav-collapsed state.
- **TanStack Query cache**: Defaults to 5-min staleTime, 10-min gcTime; overrideable per useQuery.

### Feature Flags / Settings Keys

- `sweep.mode`: 'legacy' (current, large sweeps twice/day) or 'two_tier' (plumbed but not wired; future: index ticker + detail trickle).
- `politeness.baseDelayMs`: 8000 (default).
- `politeness.jitterMs`: 2000.
- `politeness.detailDelayMs`: 10000 (detail page fetches only).
- `sweep.cronSchedule`: Cron expression read by node-cron; no hot-reload (operator restarts crawler to apply changes).
- `sources.{sourceId}.enabled`: boolean; crawler skips disabled sources on sweep-start.
- `sources.{sourceId}.filterOverrides`: JSON GenericFilter; overwrites hardcoded filter.

### Deployment Checklist

- [ ] Vite build: `cd web && pnpm build` → `dist/` folder.
- [ ] SPA served as static from Hono at `/` (index.html + hashed assets).
- [ ] Hono `/api/*` routes available to SPA via same origin (no CORS needed).
- [ ] sessionStorage available in browser (no private/incognito mode issues expected in operator context).
- [ ] TanStack Query cache survives tab reload but is cleared on new tab (expected).

## Acceptance Criteria

1. **Dashboard page loads** without error; displays latest sweep status, circuit state, and KPIs (new-today, price drops, inventory) or skeleton state if loading.
2. **Listings page renders** paginated cards or table view; FilterRail shows districts, types, and price range from facets; search input works (debounced, updates query).
3. **Sorting a table column** reorders rows client-side; clicking the same column again flips direction; null values appear at the end.
4. **Expanding a row** on Listings fetches and displays price-history panel with at least one price change visible (if data exists).
5. **Favorite/exclude toggle** on a row optimistically updates the UI and calls the correct endpoint; on error, rolls back and shows error state.
6. **Switching to Analytics** preserves the current filter state (same search query, price range, etc.); Overview tab shows KPI cards; Best Buys shows ranked table; Price Drops shows drop-events table.
7. **Filter rail hides empty filter groups** (e.g., if no districts in facets, Locality group is not shown).
8. **Sweeps page** shows a table of recent sweep runs; clicking a row navigates to SweepDetail and expands the full status/error log.
9. **Settings page** allows operator to edit politeness values, cron schedule, and source toggles; changes are persisted to the database and read by the crawler on next sweep-start.
10. **Filter editor page** fetches the taxonomy for the 999.md source and renders dynamic FilterForm; operator can toggle options, set ranges, and save; changes are written to `/sources/{id}/filter` and read by the crawler.
11. **Session persistence**: Closing the Listings table's search and re-opening it shows the same search term (from sessionStorage); closing the browser tab clears all filters.
12. **AppShell nav collapses** on click; state saved to localStorage; restores on reload.

## Open Questions / Known Gaps

1. **Real-time sweep status**: The Sweeps _list_ page polls `/sweeps?limit=20` every 5–10s. The **SweepDetail page DOES use Server-Sent Events** (`useSse` → `/api/sweeps/{id}/stream`) while the sweep is running, so per-event trace appears live without polling. There is no push for the list/Dashboard views — those still rely on polling/refetch, so a sweep that starts/ends while the operator is on another page is not surfaced until they navigate back. (Corrects the earlier "no WebSocket or push" claim, which holds only for the list/Dashboard, not SweepDetail.)
2. **Auth / TLS**: No operator authentication in this release. Anyone with network access to the Hono server can read/write settings, favorites, and sweep state. Intended for local or private deployments only.
3. **Error boundaries**: The SPA has no global error boundary. If a page component throws, the entire app crashes. Should wrap pages with error boundary + retry button.
4. **Keyboard nav**: Filter rail and tables have no keyboard shortcuts (Tab, Enter, arrow keys) beyond browser defaults. Accessibility audit deferred.
5. **Performance on large catalogs**: No virtual scrolling on Listings cards. At 1000+ listings, rendering cards may jank. Tables are paginated (50/page) so less at-risk.
6. **Type mismatch display**: The UI shows derivedType + mismatchReasons[], but the mismatchReasons array content and generation logic are undefined (TODO in server code).
7. **Analytics endpoints not fully specified**: /analytics/overview endpoint shape is inferred from Dashboard usage; Best Buys and Price Drops table structures not yet finalized. Implementation may diverge from this spec.
8. **Filter Form complexity**: The Filter page assumes a single 999.md source. If multiple sources are added, FilterForm rendering strategy (tabbed? sequential?) is TBD.
9. **Cron schedule hot-reload**: Operator must restart the crawler container (`docker restart property-crawler`) after editing `sweep.cronSchedule` in Settings. No built-in signal handling.
10. **SQLite vs Postgres**: The spec assumes Postgres (per `prisma/schema.prisma` and migration tooling), but some local-dev deployments may use SQLite. The SPA is DB-agnostic; backend API handles it.

## Reconciliation with Existing Specs

This spec supersedes or extends the following existing `.feature` files:

- **`specs/analytics-filter-parity.feature`**: Covers filter rail visibility, facet-driven option lists, and analytics endpoint contracts. This SPEC-web-spa.md provides the implementation architecture.
- **`specs/sortable-tables-listings-and-bestbuys.feature`**: Detailed useSortableTable behavior (nulls at end, direction flip, controlled sort). Implemented in `web/src/lib/useSortableTable.ts` and used by ListingsTable + BestBuysTable + PriceDropsTable.
- **`specs/2026-05-24-unified-filter-rail.feature`**: Describes the shared FilterRail component, multi-select groups, range fields, and visibility gating. This spec details the implementation.

Other specs (e.g., `ui-redesign-phase1.feature`, `mislabel-detection.feature`) document data-model or crawler changes orthogonal to this SPA spec.

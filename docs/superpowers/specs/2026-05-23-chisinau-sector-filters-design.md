# Chișinău sector derivation + data-driven filter rail — design

Date: 2026-05-23
Branch: `feature/chisinau-sector-filters`
Status: approved (design), pending spec review

## Problem

The operator wants to filter Listings and Analytics by **sub-districts of
Chișinău**, and to expose **all meaningful filters** the catalog supports.

Two findings from the live data shaped this design:

1. **The source does not subdivide Chișinău.** The 999.md locality dimension
   (`ListingFilterValue` featureId 8) treats Chișinău city as a single flat
   option (all ~176 city listings → optionId 13859), sitting *alongside* ~37
   communes/towns (Durlești, Codru, Bubuieci, Trușeni, Stăuceni, Cricova,
   Colonița, …). City sectors (Centru, Botanica, Râșcani, Ciocana, Buiucani)
   appear nowhere in the captured taxonomy — only sporadically inside the
   free-text `street` field. So sectors must be **derived**, not read.
2. **Most detail fields are unpopulated on the current dataset.** Of ~560
   active listings, only `priceEur`, `areaSqm`, and `district` have data;
   `rooms`, `landSqm`, `floors`, `yearBuilt`, `heatingType`, `sellerType` are
   ~0% (they fill in only as detail-enrichment runs). Blindly adding filters
   for them yields dead controls.

## Decisions

- **Sub-districts = derived Chișinău city sectors** (operator's choice). The 5
  official sectors, fixed set: **Centru, Botanica, Râșcani, Ciocana,
  Buiucani**. Listings that can't be classified get sector = `null`
  ("Unknown"). Communes keep their `district`; their sector stays `null`.
- **Filters are data-driven and auto-hide when empty** (operator's choice).
  Every meaningful dimension gets a server-side filter param, but the UI
  renders a control only when the facets endpoint reports that field has
  values. On today's data the visible rail is price, area, district, sector,
  type; the rest light up automatically as enrichment populates fields.
- **Sector is a persisted column**, not a query-time derivation. This mirrors
  how `district` already works: SQL-filterable in the `where` clause, so it
  paginates correctly on the server-paginated Listings page and behaves
  uniformly across Listings / Analytics / facets. (Query-time derivation —
  the pattern used for `type` — only works for the full-set aggregates in
  Analytics; it breaks Listings pagination/counts, as the code already notes
  for the `priceDrop` flag.)
- **`type` becomes a SQL-regex filter** (`title ~* 'vil[ăa]'` → Villa, `~*
  'townhouse'` → Townhouse, else House) so it works on the paginated Listings
  page. The existing post-fetch `applyTypeFilter` in Analytics is refactored
  to share the same predicate, keeping one source of truth for the buckets.

## Architecture

Three layers, following existing patterns:

### 1. Derivation (`src/lib/chisinau-sector.ts`)

```ts
export type ChisinauSector =
  | 'Centru' | 'Botanica' | 'Râșcani' | 'Ciocana' | 'Buiucani';

export function deriveSector(input: {
  district: string | null;
  street: string | null;
  title: string | null;
  description: string | null;
}): ChisinauSector | null;
```

- Only runs when `district === 'Chișinău'` (city proper); returns `null`
  otherwise.
- Precedence: (1) explicit `sect(or(ul)?)?\.?\s*<Name>` in title/description;
  (2) bare sector keyword anywhere in street/title/description (diacritic- and
  ASCII-tolerant: `r[âiî]șcani|riscani`, etc.); (3) a small curated
  street/neighborhood → sector gazetteer (Telecentru→Centru, Sculeni→Buiucani,
  Poșta Veche→Râșcani, …); (4) `null`.
- Pure function, no DB. The gazetteer is a small `Record` constant kept inline
  with a comment that it is best-effort and expected to miss.
- Expected coverage on current data: ~64% of city listings labeled, rest
  `null`.

### 2. Persistence + backfill

- **Schema:** add `sector String?` to `Listing` (nullable). Migration
  `add_listing_sector`. Add `@@index([sector])` for the facet/filter queries.
- **`src/persist.ts`:** call `deriveSector` on the upsert path (both initial
  index insert and detail-update), writing `sector`. Field is recomputed on
  every detail update so an improved gazetteer takes effect on the next sweep.
- **`scripts/backfill-sectors.ts`:** one-time pass over existing rows
  (`district='Chișinău'`, `sector IS NULL`), compute and write. Idempotent.

### 3. Query + API

- **`/api/listings/facets`** becomes the single source of truth for the rail.
  Extended to return, per dimension, its domain **and presence** — omitting
  any field with zero values:
  - `sectors: { name, count }[]` (city listings only)
  - existing `districts`, `types`, `roomsValues`, and `price`/`rooms`/`areaSqm`
    ranges
  - new ranges `landSqm`, `yearBuilt`, `floors`
  - new enums `heatingTypes`, `sellerTypes`
  - source-native option groups via the existing `/api/filters` (condition,
    offer-type, …) — presence-gated the same way
  Empty dimensions are simply absent from the payload → UI hides them.
- **`searchListings` (`src/mcp/queries.ts`) + `/api/listings`:** new query
  params, all AND-ed into the existing `where`:
  `sector` (multi), `type` (multi, via regex), `minLandSqm`/`maxLandSqm`,
  `minYearBuilt`/`maxYearBuilt`, `minFloors`/`maxFloors`, `heatingType`
  (multi), `sellerType` (multi). Source-native option groups (e.g. condition,
  offer-type) reuse the **existing** `filters` param
  (`featureId`/`optionIds` over the `ListingFilterValue` relation, already
  implemented in `searchListings` and surfaced by `/api/filters`) — no new
  JSON-contains path. Reuse the existing comma/repeat param parsing and the
  present-but-empty → 400 guard already used for `district`.
- **`/api/analytics/*` (`buildListingWhere` + `parseAnalyticsFilters`):** mirror
  the same params so a Listings filter view carries over to Analytics. Add
  `minPrice` and area range for parity. `type` moves from post-fetch to the
  shared regex predicate.

### 4. UI

- **`web/src/lib/filterSchema.ts`** (mirror of `src/types/filter.ts`): extend
  the shared filter shape with the new fields.
- **Listings sidebar (`web/src/pages/Listings.tsx`)** and **Analytics filter
  rail (`web/src/components/analytics/filters.tsx` + `Analytics.tsx`)**: render
  controls from the facets payload — a control appears only when its dimension
  is present. Sector renders as a multi-select that is only shown when
  `sectors` is non-empty (i.e. there are classified city listings). Ranges
  render as min/max; enums and features as multi-selects.

## Data flow

```
sweep → parse-detail (street/title/desc) ┐
                                          ├→ persist.ts deriveSector → Listing.sector
backfill-sectors.ts (existing rows) ──────┘

GET /api/listings/facets → {sectors,districts,types,ranges,enums,features}  (empties omitted)
                                  │
                                  ▼  drives which controls render
UI rail ── selected filters ──▶ GET /api/listings?sector=&type=&minLand=…  ──▶ searchListings(where)
                            └─▶ GET /api/analytics/*?<same params>          ──▶ buildListingWhere(where)
```

## Error handling

- Present-but-empty multi params (`?sector=`, `?sector=,,,`) → 400, matching
  the existing `district` guard (prevents silent widening to "all").
- Unknown enum/sector values → ignored (no match), not an error; the facets
  payload is advisory, not a contract.
- `deriveSector` never throws; ambiguous/no signal → `null`.

## Testing (TDD, per repo convention)

Gherkin spec: `specs/chisinau-sector-filters.feature`, one `Scenario:` → one
`it()`.

- **Unit** (`src/lib/__tests__/chisinau-sector.test.ts`): each sector via
  explicit `sect.` mention, via bare keyword, via gazetteer; commune →
  `null`; no-signal → `null`; non-Chișinău district → `null`.
- **Integration** (testcontainer Postgres):
  - `searchListings` / `/api/listings`: each new param filters correctly and
    paginates; present-but-empty → 400; combined AND semantics.
  - `/api/listings/facets`: omits empty dimensions; includes `sectors` with
    counts when classified rows exist.
  - analytics parity: same params accepted; `type` regex matches post-fetch
    behavior it replaces.
  - Seeds must mirror `persist.ts` (set `sector` like production would).
- **UI** (happy-dom): rail hides a dimension when facets omits it; sector
  multi-select shown only when `sectors` present.

## Out of scope (YAGNI)

- Improving sector coverage beyond the keyword + small gazetteer (no NLP, no
  full street database).
- Sectors for communes (they are not subdivided).
- New crawl-side locality options (`LOCALITIES` enum / Settings → Global
  Filter) — this is browse-side only.
- Persisting `type` as a column (regex predicate is sufficient).

## Affected files

New: `src/lib/chisinau-sector.ts`, `scripts/backfill-sectors.ts`,
`prisma/migrations/<ts>_add_listing_sector/`, `specs/chisinau-sector-filters.feature`,
plus the test files above.
Modified: `prisma/schema.prisma`, `src/persist.ts`, `src/mcp/queries.ts`,
`src/web/routes/listings.ts`, `src/web/routes/analytics.ts`,
`src/lib/listing-type.ts` (export shared type predicate),
`web/src/lib/filterSchema.ts`, `web/src/pages/Listings.tsx`,
`web/src/pages/Analytics.tsx`, `web/src/components/analytics/filters.tsx`.

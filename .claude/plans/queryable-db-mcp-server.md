# Feature: Queryable Listings DB + Local MCP Server for Claude Desktop

## Context

The crawler now reliably populates a SQLite DB with houses-for-sale-in-Chișinău
listings (~3,300 rows). The user wants to **ask natural-language questions** like
*"3+ rooms in Botanica under 90k EUR with autonomous heating"* from
**Claude Desktop** (chosen over Claude Code for its analysis/visualization
capabilities) and get back **clickable 999.md links** to inspect details
manually. They explicitly want this to work with **all filters 999.md exposes**
for the houses category, not a hand-picked few.

Two hard constraints:

1. **Zero increase in 999.md traffic at query time.** The query layer reads only
   the local SQLite — no proxying through to 999.md. The crawler stays the only
   process that talks to the site.
2. **The crawler must remain low-profile.** The user is concerned about being
   blocked or complained to. The current cadence (8s±2s, concurrency 1, 24h
   circuit breaker) is already conservative; this feature must not regress that
   profile and should fix the few remaining bot tells along the way.

The DB lives entirely on the macbook (no Docker/ZBook split for now), which
keeps deployment trivial: a local stdio MCP subprocess that Claude Desktop
spawns on demand reads the same SQLite file the crawler writes to.

## Approach

Three pieces, in dependency order:

### 1. Schema enrichment — relational filter table

Today the `Listing` model has 13 hardcoded columns ([prisma/schema.prisma:13-45](../../prisma/schema.prisma#L13-L45))
and drops anything else. To support arbitrary 999.md filters, add a new
relational table that's indexed for fast facet queries:

```prisma
model ListingFilterValue {
  id           Int     @id @default(autoincrement())
  listingId    String
  filterId     Int
  featureId    Int
  optionId     Int?
  textValue    String?
  numericValue Float?
  Listing      Listing @relation(fields: [listingId], references: [id], onDelete: Cascade)
  @@index([filterId, featureId, optionId])
  @@index([listingId])
}
```

Also add to `Listing`:
- `filterValuesEnrichedAt DateTime?` — null until first detail fetch populates filter rows. Used by the trickle backfill query.
- `filterValues ListingFilterValue[]` — back-relation.

Relational beats JSON because facet queries (`WHERE filterId=X AND optionId IN (...)`) hit the index in O(log n); a JSON `filterValues` blob would force a full-table scan.

### 2. Crawler enrichment — capture filter values during the existing detail fetch

**No new HTTP requests.** The current `GetAdvert` GraphQL call already happens
for every new listing ([src/sweep.ts:108](../../src/sweep.ts#L108)). We extend the
query selection set to also request the generic `features` array (the FEATURE_*
wrappers visible in `src/__tests__/fixtures/advert-detail-response.json`), then
extract filter triples in `parseDetail` and write them to `ListingFilterValue`
in the same `persistDetail` transaction.

**Critical sub-step: capture the real GraphQL query string.** Per
[../progress.md](../progress.md)'s blocker, the query strings in
[src/graphql.ts](../../src/graphql.ts) are best-effort reconstructions and have
not yet been verified against live 999.md. We must capture both `SearchAds` and
`GetAdvert` from a real browser session before this feature ships, because we'll
be modifying `GetAdvert` to request the full features array. The proposed
[docs/capture-session.md](../../docs/capture-session.md) workflow covers this —
execute it once, paste the captured strings into `src/graphql.ts`, then extend
the `GetAdvert` selection set with the features field.

#### 2a. Politeness-profile fixes (bundled with this work)

The user explicitly asked for "100% sure not blocked or complained to". Five
small request-shape improvements that make GraphQL POSTs look like a real
browser instead of an API-direct probe — bundle these with the feature since
we're touching `fetch.ts` anyway:

1. **Fix `Accept` header for POSTs** ([src/fetch.ts:144](../../src/fetch.ts#L144)) —
   currently sends `text/html,application/xhtml+xml` even for GraphQL POSTs.
   Send `application/json, text/plain, */*` for POST, keep current for GET.
2. **Add `Origin` and `Referer`** on every GraphQL request:
   `Origin: https://999.md`, `Referer: https://999.md/ro/list/real-estate/houses-and-yards`.
3. **Add `Sec-Fetch-*` headers** that real Firefox sends:
   `Sec-Fetch-Dest: empty`, `Sec-Fetch-Mode: cors`, `Sec-Fetch-Site: same-origin`.
4. **Detect HTML interstitials.** If a GraphQL response comes back with
   `content-type: text/html`, treat it as a soft block: trip the breaker, log
   loudly, do not attempt to JSON.parse. Currently we'd crash and continue —
   a CAPTCHA challenge would slip silently.
5. **Wire up `detailDelayMs`** ([src/config.ts:63](../../src/config.ts#L63)).
   Already defined (10s) but unused — `Fetcher.run` applies the same
   `baseDelayMs` (8s) to every request. Add a per-call `delayMs` override and
   use 10s±2s for detail fetches, 8s±2s for index. Mimics human "thinking time"
   on detail pages.

These are deliberately minimal. **Deferred** to a separate follow-up unless the
user opts in: cookie jar, HTML warm-up navigation, cron jitter / overnight skip,
per-sweep detail-fetch cap. The current cadence is already conservative;
profile gains beyond the five items above have diminishing returns relative to
engineering cost.

#### 2b. Backfill — trickle strategy

3,300 existing listings have no filter rows. After the schema migration,
extend the sweep to add one extra step **after** new-listing detail fetches:

```
re-fetch up to N (default 30) listings where filterValuesEnrichedAt IS NULL,
oldest lastFetchedAt first
```

At 30/sweep × 24 sweeps/day = ~720/day → full backfill in ~5 days. Each extra
fetch uses the same 8s±2s gap, so the per-sweep request shape is
indistinguishable from a sweep with 30 new listings — a pattern that occurs
naturally already. **No burst; no pattern change visible at the rate-limiter.**

Cap is configurable via `SWEEP.backfillPerSweep` so it can be raised once we're
confident, or set to 0 to disable backfill entirely (option (a) "patient drift"
from the brainstorm).

### 3. MCP server — `house-track-mcp` (local stdio, spawned by Claude Desktop)

A separate small entrypoint (`src/mcp/server.ts`) that uses
`@modelcontextprotocol/sdk` and reads the same Prisma DB the crawler writes
to. **Read-only** — no mutations exposed.

**Three tools:**

- **`list_filters()`** → returns the *observed* filter universe, derived by
  aggregating `ListingFilterValue` rows. Shape:
  ```ts
  Array<{
    filterId: number;
    featureId: number;
    optionIds: number[];        // distinct option values seen
    sampleListingIds: string[]; // up to 3, for Claude to fetch one and see labels
    listingCount: number;
  }>
  ```
  Why "observed" rather than "authoritative": we don't yet have the 999.md
  GraphQL operation that returns the filter taxonomy with multilingual labels
  (no `categoryFilters`-shaped query is captured — see explore agent's finding
  D). Discovering it from a browser session is a follow-up; until then,
  observed values cover ~all values some real listing has, which is enough for
  filtering. Labels can be derived by Claude calling `get_listing` on a sample
  ID and reading the label fields off the returned features.

- **`search_listings({ minPrice?, maxPrice?, minRooms?, maxRooms?, district?, minAreaSqm?, maxAreaSqm?, filters?: Array<{filterId, featureId, optionIds: number[]}>, sort?: 'priceAsc'|'priceDesc'|'pricePerSqmAsc'|'newest', limit?: number })`**
  → returns matching listings as **structured JSON** (not pre-formatted text)
  so Claude Desktop's analysis/visualization tool can render charts (price-vs-area
  scatter), tables, and maps once `lat/lon` lands. Shape:
  ```ts
  Array<{
    id: string;
    url: string;             // https://999.md/ro/<id> — clickable link
    title: string;
    priceEur: number | null;
    priceRaw: string | null;
    areaSqm: number | null;
    rooms: number | null;
    district: string | null;
    firstSeenAt: string;     // ISO
    lastSeenAt: string;      // ISO
  }>
  ```
  Multi-filter `filters` array is AND-ed across (filterId, featureId), OR-ed
  within a single (filterId, featureId)'s optionIds. Implementation: a single
  Prisma query with one nested `every` per filter group.

- **`get_listing(id)`** → full record including all filter values
  (`{filterId, featureId, optionId, textValue, numericValue}[]`) and the
  feature labels Claude needs to translate option IDs back to "Botanica",
  "autonomous heating", etc.

**Wiring into Claude Desktop:** `claude_desktop_config.json` snippet
documented in `docs/mcp-setup.md`:

```json
{
  "mcpServers": {
    "house-track": {
      "command": "node",
      "args": ["/Users/egorg/Dev/house-track/house-track/dist/mcp/server.js"],
      "env": { "DATABASE_URL": "file:/Users/egorg/Dev/house-track/house-track/data/dev.db" }
    }
  }
}
```

Claude Desktop spawns it on demand, kills it on exit. No always-running
process.

## Files to Create / Modify

**New:**
- `src/mcp/server.ts` — MCP server entrypoint, three tools above
- `src/mcp/queries.ts` — Prisma query helpers (search_listings, list_filters, get_listing) — separated from the MCP transport so they're unit-testable without the SDK
- `src/__tests__/mcp-queries.test.ts` — unit tests for the query helpers
- `prisma/migrations/<ts>_add_listing_filter_value/migration.sql` — generated by `pnpm prisma migrate dev`
- `docs/mcp-setup.md` — Claude Desktop configuration walkthrough
- `specs/queryable-db.feature` — Gherkin acceptance scenarios

**Modify:**
- `prisma/schema.prisma` — add `ListingFilterValue` + `filterValuesEnrichedAt`
- `src/types.ts` — add `FilterValueTriple`, extend `ParsedDetail` with `filterValues: FilterValueTriple[]`
- `src/graphql.ts` — extend `GET_ADVERT_QUERY` to request `features` array (after capturing real query string per `.claude/progress.md` blocker)
- `src/parse-detail.ts` — extract `filterValues` from response
- `src/persist.ts` — write `ListingFilterValue` rows in the same transaction as `Listing` upsert; set `filterValuesEnrichedAt`
- `src/sweep.ts` — add backfill step after `fetchAndPersistDetails` (re-fetch up to `SWEEP.backfillPerSweep` listings with NULL `filterValuesEnrichedAt`, oldest first)
- `src/fetch.ts` — header improvements (Accept fix, Origin/Referer, Sec-Fetch-*, HTML-interstitial detection, per-call delayMs override)
- `src/config.ts` — add `SWEEP.backfillPerSweep` (default 30); add `POLITENESS.headersPerOperation` if needed; remove or wire up `detailDelayMs`
- `package.json` — add `@modelcontextprotocol/sdk` dep; add `mcp` script (`tsx src/mcp/server.ts` for dev, compiled binary for Desktop)

**Reuse (don't recreate):**
- `Persistence` class ([src/persist.ts](../../src/persist.ts)) — extend, don't replace
- `Fetcher` class ([src/fetch.ts](../../src/fetch.ts)) — add header config, don't rewrite
- `runSweep` ([src/sweep.ts:39](../../src/sweep.ts#L39)) — add backfill step inside, don't fork

## Verification

Run end-to-end on the macbook:

1. **Schema migration:**
   ```bash
   pnpm prisma migrate dev --name add_listing_filter_value
   pnpm prisma generate
   ```
   Verify with `pnpm prisma studio` that `ListingFilterValue` exists.

2. **Capture real GraphQL queries** (per `docs/capture-session.md`) and paste into `src/graphql.ts`. Verify against fixtures: `pnpm test`.

3. **Unit tests pass:** `pnpm test` (existing 70 + new MCP query tests + new parse-detail filter-extraction tests).

4. **Typecheck + lint:** `pnpm typecheck && pnpm lint`.

5. **One live sweep** with `RUN_ONCE=1 pnpm dev`. Confirm:
   - No 403/429 (politeness profile holds)
   - `ListingFilterValue` rows exist for new listings (`pnpm prisma studio`)
   - `filterValuesEnrichedAt` populated on those listings
   - Backfill picked up ~30 oldest non-enriched listings
   - Sweep duration ≈ 6min (index) + (new+30)·8s (details) — within expected envelope

6. **Build MCP binary:** `pnpm build`. Verify `dist/mcp/server.js` exists.

7. **Wire Claude Desktop** per `docs/mcp-setup.md`. Restart Desktop. Tools should appear in the MCP picker.

8. **Smoke queries from Claude Desktop:**
   - "List all distinct filters you have observed." → `list_filters` returns non-empty array.
   - "Show me the 10 cheapest houses under 80k with at least 3 rooms." → `search_listings` returns ≤10 rows; manually click a returned URL to confirm it loads on 999.md.
   - "Plot price vs. area for everything under 100k." → Claude Desktop runs `search_listings`, then renders a chart in its analysis panel.

9. **Politeness profile check** — capture one outgoing GraphQL request via `mitmproxy` (or read a real undici trace) and diff its headers against a real Firefox request from the browser DevTools. Verify Accept, Origin, Referer, and Sec-Fetch-* are now present and correct.

## Out of Scope (Explicit Deferrals)

- **Filter taxonomy GraphQL operation** — discovering 999.md's `categoryFilters`-shaped query for authoritative multilingual labels. Until then, `list_filters` returns observed values; labels are derivable by `get_listing(sampleId)`. Track in `.claude/progress.md` as a follow-up alongside the existing query-capture blocker.
- **`lat/lon`, `rooms`-from-description, district normalization** — already deferred per `.claude/progress.md`. These are independent enrichments and can land in any order. Map-distance queries need `lat/lon` first.
- **Cookie jar, HTML warm-up navigation, cron jitter, per-sweep detail cap** — politeness layer-3 / layer-4 improvements. Punt unless we observe blocking.
- **Pruning / TTL** of stale listings ("I don't need to keep the whole DB on my side"). Current behavior: `markInactiveOlderThan` flips `active=false` after 3 missing sweeps but rows stay forever. Adding a hard-delete TTL is a separate small PR.
- **Remote MCP server / Docker deployment.** Everything stays on the macbook for now.

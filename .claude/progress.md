# Session Progress — house-track

> Auto-injected at session start. Update this file at the end of each session.

**Last updated:** 2026-05-01
**Branch:** `claude/scaffold-house-track-EW7gc`
**Last commit:** _(uncommitted: queryable DB + MCP server + politeness fixes)_

---

## This session: queryable DB + local MCP server (146/146 tests green)

Plan: [.claude/plans/queryable-db-mcp-server.md](plans/queryable-db-mcp-server.md)
Spec: [specs/queryable-db.feature](../specs/queryable-db.feature) (16 scenarios)

Three things shipped together via `/feature` TDD:

### 1. Schema enrichment — `ListingFilterValue`

- New relational table `(filterId, featureId, optionId, textValue, numericValue)`
  with indexes on `(filterId, featureId, optionId)`, `(featureId, optionId)`, `(listingId)`.
- Listing gets `filterValuesEnrichedAt DateTime?` (null on legacy rows + index-only listings).
- Migration `20260501162110_add_listing_filter_value` checked in.
- `filterId` defaults to 0 (unknown). The 999.md taxonomy query for the
  authoritative `(filterId → featureId)` mapping is still uncaptured —
  queries match on `(featureId, optionId)` until that lands.

### 2. Crawler enrichment

- `parseDetail` now extracts a `filterValues: FilterValueTriple[]` array by walking
  the advert's top-level `FEATURE_*`-typed entries. Handles FEATURE_OPTIONS,
  FEATURE_OFFER_TYPE, FEATURE_TEXT, FEATURE_INT, FEATURE_PRICE; skips FEATURE_BODY
  / FEATURE_IMAGES / FEATURE_MAP_POINT (already stored elsewhere).
- `persistDetail` writes triples atomically with the listing upsert (single
  `$transaction`); deletes-then-inserts so removed features on 999.md don't
  linger. Sets `filterValuesEnrichedAt = now()`.
- `runSweep` adds a backfill step **after** new-listing detail fetches:
  `findUnenrichedListings(SWEEP.backfillPerSweep=30)` → fetch+parse+persist
  each, sharing the same 8s±2s gap. 30/sweep × 24/day → ~5 days for full ~3,300
  backfill. Set `backfillPerSweep=0` to disable.
- Backfill failures don't kill the sweep (status flips to `partial`); a
  `CircuitTrippingError` mid-backfill aborts cleanly with `circuit_open`.

### 3. Politeness profile fixes (bundled — minimal blast radius)

- GraphQL POSTs send `Accept: application/json, text/plain, */*` (was the
  HTML `Accept` even on POST).
- All GraphQL POSTs now carry `Origin: https://999.md`,
  `Referer: https://999.md/ro/list/real-estate/houses-and-yards`,
  `Sec-Fetch-{Dest=empty,Mode=cors,Site=same-origin}` — same-origin XHR shape.
- HTML interstitial detection: a 200-OK response with `content-type: text/html`
  on a GraphQL endpoint trips the breaker before `JSON.parse` runs (CAPTCHA
  page would silently crash today).
- `fetchGraphQL` accepts `{ delayMs }` override; `fetchAdvert` calls now use
  `POLITENESS.detailDelayMs = 10_000` (was sharing the index's 8s gap).
  Index pages still use 8s±2s.

### 4. Local MCP server — `house-track` (stdio, spawned by Claude Desktop)

- `src/mcp/server.ts` — `@modelcontextprotocol/sdk` McpServer over StdioTransport.
  Three tools: `list_filters()`, `search_listings(...)`, `get_listing(id)`.
  Inputs validated by zod. `limit` capped at 500.
- `src/mcp/queries.ts` — Prisma query helpers separated from the MCP transport
  so they're unit-testable without spinning up stdio JSON-RPC. 18 tests cover
  range filters, multi-filter AND/OR semantics, sort, limit, sample ids,
  observed-universe aggregation.
- `docs/mcp-setup.md` — Claude Desktop config snippet.
- Build target: `dist/mcp/server.js`. `pnpm mcp` for tsx-watched dev.

| Module | Status | Tests |
|---|---|---|
| `src/circuit.ts` | unchanged | 8 |
| `src/fetch.ts` | EXTENDED — politeness fixes + delayMs override + HTML interstitial | 25 |
| `src/persist.ts` | EXTENDED — `$transaction` writes filter values; `findUnenrichedListings` | 16 |
| `src/sweep.ts` | EXTENDED — backfill step + `backfillPerSweep` dep | 14 |
| `src/parse-detail.ts` | EXTENDED — `extractFilterValues` walk | 19 |
| `src/parse-index.ts` | unchanged | 13 |
| `src/log.ts` | unchanged | 2 |
| `src/mcp/queries.ts` | NEW — list_filters / search_listings / get_listing | 18 |
| `src/mcp/server.ts` | NEW — McpServer + StdioServerTransport | (transport only) |
| `prisma/schema.prisma` | EXTENDED — `ListingFilterValue` + `filterValuesEnrichedAt` | — |
| `src/types.ts` | EXTENDED — `FilterValueTriple`, `ParsedDetail.filterValues` | — |
| `src/config.ts` | EXTENDED — `acceptJson`/`origin`/`referer`, `SWEEP.backfillPerSweep=30` | — |

**Security review:** 0 critical, 0 high, 1 medium (auto-fixed: defensive
`parseImageUrls` try/catch in `getListing`), 2 low (notes only).

---

## Still blocking live smoke

`src/graphql.ts` carries query strings the prior session marked as captured,
but the captured `GET_ADVERT_QUERY` selection set is **minimal** (id, state,
title, posted, reseted, expire, isExpired, owner, autoRepublish, moderation,
package, subCategory) and does NOT request the price/body/region/city/
street/mapPoint/images/offerType fields the fixture and `parseDetail`
depend on. Either the capture grabbed a different/lighter operation than
the page actually uses, or 999.md has multiple `GetAdvert` variants.

**Before `RUN_ONCE=1 pnpm dev` will populate filter values from live 999.md:**
re-capture `GetAdvert` from a real browser session and paste a selection set
that matches the fixture shape. The parser tolerates missing fields, but
without them the per-listing filter triples will be empty.

The MCP server itself works against any populated DB — even a sparsely
backfilled one — so this blocker is for *backfill quality*, not MCP usability.

---

## Next session

1. **Re-capture `GetAdvert` with the full feature selection set** (price, body,
   region, city, street, offerType, plus any `feature(id: N)` calls the page
   actually requests). Paste into `src/graphql.ts`. Refresh fixtures.

2. **Wire Claude Desktop** per `docs/mcp-setup.md`: `pnpm build`, edit
   `claude_desktop_config.json`, restart Desktop, smoke-test all three tools.

3. **End-to-end smoke**: `RUN_ONCE=1 pnpm dev` against real 999.md.
   Verify with `pnpm prisma studio`:
   - `ListingFilterValue` rows for new listings
   - `filterValuesEnrichedAt` populated
   - Backfill picked up ~30 oldest non-enriched listings
   - No 403/429 (politeness profile holds)

4. **Optional follow-ups (deferred):**
   - Capture 999.md's filter taxonomy query → populate authoritative
     `filterId` (replace 0 placeholder); enables labeled `list_filters`.
   - Add `lat/lon` columns + migration; populate from `mapPoint.value`.
   - Rename `rawHtmlHash` column → `rawContentHash`.
   - Parse `rooms` from description text.
   - Cron jitter / overnight skip; HTML warm-up navigation; cookie jar.

# Session Progress — house-track

> Auto-injected at session start. Update this file at the end of each session.

**Last updated:** 2026-04-26
**Branch:** `claude/scaffold-house-track-EW7gc`
**Last commit:** _(uncommitted: GraphQL parsers + fetcher + sweep migration)_

---

## MAJOR DISCOVERY: 999.md uses GraphQL, not HTML

999.md is a Next.js App Router site. Listings are loaded via a GraphQL API at
`https://999.md/graphql` (POST, Content-Type: application/json). No HTML parsing
is needed for listing data.

**Two operations needed:**
1. `SearchAds` — paginated index (all listings matching filters)
2. `GetAdvert` (using `advert(input: {id})` query) — full detail for one listing

**Verified filter IDs (2026-04-26):**
- `subCategoryId: 1406` → house-and-garden
- `filterId 41, featureId 1, optionId 776` → "Vând" (for sale) — NOT 903 (daily rental)
- `filterId 40, featureId 7, optionId 12900` → Chișinău municipality
- Listing URL format: `https://999.md/ro/<id>` (NOT `/advert/<id>`)
- Total Chișinău houses for sale: ~3,302

**WARNING:** URL param ID space (`o_41_1=903`) ≠ GraphQL optionId space.
- URL param 903 = daily rental
- GraphQL optionId 903 = daily rental
- GraphQL optionId 776 = "Vând" (sale) ✅

**Fixtures saved:**
- `src/__tests__/fixtures/search-ads-response.json` — 5 Chișinău sale listings + count
- `src/__tests__/fixtures/advert-detail-response.json` — full detail for id 104027607

---

## Current state

GraphQL migration done via TDD. **70/70 tests pass.** Typecheck, lint, build all green. `cheerio` removed from deps.

| Module | Status | Tests |
|---|---|---|
| `src/circuit.ts` | DONE — sentinel-file breaker, threshold + cooldown | 7 |
| `src/fetch.ts` | DONE — undici client + `fetchGraphQL(endpoint, op, vars, query)` shares politeness/retry/circuit | 17 |
| `src/persist.ts` | DONE — Prisma upsert, snapshot diff on rawHtmlHash, sweep round-trip | 10 |
| `src/sweep.ts` | DONE — GraphQL-native deps: `fetchSearchPage(pageIdx)` + `fetchAdvert(id)` callbacks; optional `applyPostFilter` | 8 |
| `src/log.ts` | DONE — pino w/ service binding | 2 |
| `src/parse-index.ts` | DONE — `parseIndex(json)` + `applyPostFilter(stubs, filter)` | 13 |
| `src/parse-detail.ts` | DONE — `parseDetail(id, json)`; throws `AdvertNotFoundError` on null advert | 13 |
| `src/graphql.ts` | NEW — query strings (PLACEHOLDER bodies) + `buildSearchVariables`/`buildAdvertVariables` | — |
| `src/index.ts` | DONE — wires fetchGraphQL → fetchSearchPage/fetchAdvert; passes `applyPostFilter(_, FILTER.postFilter)` | (no test) |
| `src/config.ts` | DONE — GraphQL endpoint, filter IDs, postFilter, pageSize | — |

**Type changes this session:**
- `ListingStub` gained `areaSqm: number | null` (parsed from title — needed for postFilter at index time).
- `rawHtmlHash` field name retained (matches Prisma column) but value semantics changed to JSON-field hash. Migration to rename column is deferred.
- `lat/lon` deferred — would require Prisma migration; not blocking POC.

---

## ⚠️ BLOCKER for live smoke: real GraphQL query bodies

`src/graphql.ts` has BEST-EFFORT-RECONSTRUCTED query strings. They mirror the field shape
in the fixtures, but were not captured from a real browser session, so 999.md may reject
them with "Unknown argument" / type mismatches.

**Before `RUN_ONCE=1 pnpm dev` will work against live 999.md:**
1. Open https://999.md/ro/list/real-estate/houses-and-yards in DevTools → Network
2. Filter to `graphql` requests → find one whose payload `operationName` is `SearchAds`
3. Copy the `query` string verbatim → replace `SEARCH_ADS_QUERY` in `src/graphql.ts`
4. Click into a listing → repeat for the `GetAdvert` operation → replace `GET_ADVERT_QUERY`
5. Verify the `variables` shape in the captured request matches what `buildSearchVariables`/
   `buildAdvertVariables` produce. Adjust either side if not.

The variable BUILDERS (`buildSearchVariables`, `buildAdvertVariables`) and the `searchInput`
in `config.ts` are verified — only the raw GraphQL strings need updating.

**Proposed workflow improvement (not yet built):** add a project-local script
`scripts/capture-graphql.ts` (or `docs/capture-graphql.md` runbook) that drives
Playwright MCP against 999.md, intercepts the `SearchAds` and `GetAdvert` POSTs,
and writes the captured `query` strings directly into `src/graphql.ts` (and refreshes
the JSON fixtures while it's there). Project-scoped — not a generic Claude Code
skill. Worth building before the next fixture refresh (every time 999.md changes
its schema, this manual capture step recurs).

---

## Next session

1. **Capture real GraphQL queries** (see blocker above) and paste into `src/graphql.ts`.

2. **End-to-end smoke**: `RUN_ONCE=1 pnpm dev` against real 999.md GraphQL.
   Expect: pre-flight, ~42 SearchAds pages over ~6 minutes (8s spacing × 42), then
   N detail fetches for new listings (slower — 8s each). Monitor logs; check SQLite
   row count.

3. **Docker tick**: `docker compose up --build -d` and watch one cron tick complete.

4. **Optional follow-ups (not POC-blocking)**:
   - Add `lat/lon` to `Listing` schema + migration; populate from `mapPoint.value`.
   - Rename `rawHtmlHash` column → `rawContentHash` for clarity.
   - Parse `rooms` from description text ("3 dormitoare" / "3 спальни").

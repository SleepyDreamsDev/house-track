# Session Progress — house-track

> Auto-injected at session start. Update this file at the end of each session.

**Last updated:** 2026-04-26
**Branch:** `claude/scaffold-house-track-EW7gc`
**Last commit:** config: switch to GraphQL endpoint + correct filter IDs

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

**Data available from SearchAds per listing:**
- id, title (contains area+suburb e.g. "Casă, 140 m², Colonița"), price (value + currency),
  pricePerMeter, images[], offerType, region, city, reseted (refresh date)

**Data available from GetAdvert per listing:**
- All of the above plus: body (description in ro/ru), street, mapPoint (lat/lon),
  state (AD_STATE_PUBLIC etc.), isExpired, expire date, owner

**Fixtures saved:**
- `src/__tests__/fixtures/search-ads-response.json` — 5 Chișinău sale listings + count
- `src/__tests__/fixtures/advert-detail-response.json` — full detail for id 104027607

---

## Current state

I/O-layer implementation done via TDD. **36/36 tests pass.**

| Module | Status | Tests |
|---|---|---|
| `src/circuit.ts` | DONE — sentinel-file breaker, threshold + cooldown | 7 |
| `src/fetch.ts` | DONE — undici client, 8s±jitter spacing, 5xx retries, 403/429 → CircuitTrippingError | 10 |
| `src/persist.ts` | DONE — Prisma upsert, snapshot diff on rawHtmlHash, sweep round-trip | 10 |
| `src/sweep.ts` | DONE — orchestrator: pre-flight → paginate → diff → fetch+parse+persist details | 7 |
| `src/log.ts` | DONE — pino w/ service binding | 2 |
| `src/index.ts` | DONE — wires all the above + node-cron (buildIndexUrl is temp stub) | (no test) |
| `src/config.ts` | UPDATED — GraphQL endpoint, correct optionId 776 (sale), Chisinau filter | — |
| `src/parse-index.ts` | STUB — needs TDD against search-ads-response.json fixture | — |
| `src/parse-detail.ts` | STUB — needs TDD against advert-detail-response.json fixture | — |

Tooling: pnpm install ✓, prisma generate ✓, typecheck ✓, lint ✓, build ✓.

---

## Architecture change needed (parse-index TDD cycle)

The sweep.ts/fetch.ts interface still speaks HTML URLs. Next TDD cycle must migrate to GraphQL:

1. Add `fetchGraphQL(operationName, variables, query)` method to `Fetcher` (fetch.ts)
2. Change `SweepDeps`:
   - `parseIndex: (json: unknown) => ListingStub[]` (was `html: string`)
   - `parseDetail: (id: string, json: unknown) => ParsedDetail` (was `url, html: string`)
   - `buildSearchInput: (page: number) => SearchInput` (replaces `buildIndexUrl`)
3. Update `runSweep` to call `fetchGraphQL` instead of `fetchPage`
4. Remove `cheerio` dependency (not needed for JSON parsing)

**rawHtmlHash** becomes **rawJsonHash** — hash the price+title+state JSON fields.

---

## Next session

1. TDD `parse-index.ts` against `search-ads-response.json` fixture:
   - Map GraphQL ads[] → ListingStub[]
   - Parse area from title regex ("Casă, 140 m², Colonița" → 140)
   - Parse price from feature(id:2).value (handle UNIT_EUR vs UNIT_MDL)
   - Apply postFilter (maxPriceEur, maxAreaSqm) — filter here or in sweep?

2. TDD `parse-detail.ts` against `advert-detail-response.json` fixture:
   - Map advert JSON → ParsedDetail
   - Compute rawJsonHash from stable fields (price+title+state)
   - Extract description body.value.ro

3. Migrate `sweep.ts` / `fetch.ts` to GraphQL interface (see Architecture change above)

4. End-to-end smoke: `RUN_ONCE=1 pnpm dev` against real 999.md GraphQL.

5. `docker compose up --build -d` and watch one tick.

6. Check `types.ts` — update ParsedDetail if fields changed (rawHtmlHash → rawJsonHash,
   add lat/lon, remove HTML-specific fields).

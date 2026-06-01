# house-track — System Specification (Overview)

> Top-level spec. Ties together every `SPEC-*.md` subsystem spec. For the
> prose source-of-truth on scope and politeness, see [`docs/poc-spec.md`](../docs/poc-spec.md);
> for stack and conventions, [`CLAUDE.md`](../CLAUDE.md).

## System Purpose & Scope

house-track is a polite, single-source crawler + analytics console that watches
**999.md** for **houses and villas for sale** in **Chișinău municipality + Durlești**,
constrained to **≤ €250,000** and **≤ 200 m²**, and turns the resulting time-series
into a "best-buy" signal for a single operator.

The thesis is a buyer's-edge one: continuously harvest the in-budget house
inventory, version every listing's price/description over time, and surface the
properties that are statistically underpriced for their cohort (sector × rooms ×
area × price-band) before a human would notice. Output is a local operator SPA
plus a read-only MCP side-channel for ad-hoc analysis from Claude Desktop.

**Who operates it.** One owner-operator, on a home server (the "ZBook") alongside
Home Assistant, via Docker Compose on `127.0.0.1` — no auth, no TLS, no
multi-tenancy. Reverse-proxy or LAN trust is assumed.

**Scope boundaries (locked):**

| Dimension   | In scope                                | Out of scope (deferred)                 |
| ----------- | --------------------------------------- | --------------------------------------- |
| Source      | 999.md only (`999md` adapter)           | makler.md, lara.md (Phase 5)            |
| Category    | Houses & villas (`subCategoryId 1406`)  | Apartments (`1404` plumbed, not active) |
| Deal        | Sale (`offerType` optionId 776, "Vând") | Rent                                    |
| Location    | Chișinău municipality + Durlești        | Other raions                            |
| Constraints | ≤ 200 m², ≤ €250k                       | —                                       |
| Delivery    | Operator SPA + MCP                      | Telegram bot, push, mobile (Phases 3/6) |
| Auth        | none (local trust)                      | multi-user auth + TLS                   |

The POC milestone — 7 days of hourly sweeps at ≥95% `status=ok`, ≥200 unique
listings, zero 403/429, observed price-change snapshots — is achieved; Phase 4
(operator UI + analytics) shipped ahead of schedule. Several P2 columns
(`lat`/`lon`, `authorId`, `phone`, `canonicalId`) exist in schema and are wired
defensively but stay null until the next live capture extends `GetAdvert`.

---

## Component Map / Architecture

```
                                 ┌─────────────────────────────────────────────┐
                                 │                  999.md                       │
                                 │      POST /graphql  (SearchAds, GetAdvert,    │
                                 │            FILTER_TAXONOMY placeholder)        │
                                 └───────────────▲───────────────┬───────────────┘
       politeness: 8s±2s gap, conc=1,            │ index/detail  │ HTML/JSON
       Firefox UA, no cookies, 10s detail        │ GraphQL POST  │
                                                 │               ▼
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │                              CRAWLER  (src/, Node 22 ESM)                       │
   │                                                                                │
   │  index.ts ──cron(0 9,21)──► sweep.ts ──► fetch.ts ──► circuit.ts (sentinel)    │
   │  (bootstrap, tick guards)   (runSweep)   (Fetcher)    /data/.circuit_open      │
   │       │                        │                                               │
   │       │ resolveActiveFilter    │ parse                                         │
   │       ▼                        ▼                                               │
   │  filter-resolver.ts ◄── sources/999md.ts      parse-index.ts ─► ListingStub[]  │
   │  settings.ts (Setting)         (resolve)       parse-detail.ts ─► ParsedDetail  │
   │  config.ts (FILTER)            taxonomy-labels.ts / parse-taxonomy.ts (LUT)     │
   │                                        │                                       │
   │                                        ▼                                       │
   │                                   persist.ts ──────────► PostgreSQL (Prisma)   │
   │  lib/ (pure analytics):           (upsert + snapshot     Listing/Snapshot/     │
   │  classification · sector ·         + filter-value replace ListingFilterValue/  │
   │  hedonic · market-signals ·        + dedup clusters)      SweepRun/Source/      │
   │  market-index · dedup · listing-text                      Setting/FetchTask/    │
   │                                                            ThrottleEvent        │
   └──────────────────────────────────────┬─────────────────────────┬──────────────┘
                                           │ getPrisma() (rw)         │ DATABASE_URL_RO (ro role)
                          ┌────────────────▼─────────────┐   ┌────────▼───────────────────┐
                          │  HONO API  (src/web/, :3000)  │   │  MCP SERVER (src/mcp/, stdio)│
                          │  /api/listings /sweeps        │   │  list_filters search_listings│
                          │  /analytics /settings /filter │   │  get_listing run_sql         │
                          │  /sources /circuit + SSE      │   │  schema://house-track        │
                          └────────────────┬──────────────┘   └────────▲────────────────────┘
                                           │ /api/* (same origin)       │ JSON-RPC over stdio
                          ┌────────────────▼──────────────┐            │
                          │  SPA  (web/, Vite+React18+TW4) │            │
                          │  Dashboard Listings Sweeps     │     Claude Desktop (operator,
                          │  Filter Analytics Settings     │      ad-hoc SQL / analysis)
                          └────────────────────────────────┘
```

The **crawl → parse → persist → analytics → API → SPA** spine is the production
path. The **MCP server** is a read-only side-channel: a separate process, a
separate (SELECT-only) DB role, never on the write path.

---

## End-to-End Data Flow (a listing's lifecycle)

A single listing from a 999.md page to a best-buy signal:

1. **Schedule.** `index.ts` cron fires (`0 9,21 * * *`, ±`cronWindowJitterMs`).
   `tick()` checks quiet hours (`[2,6)` Chisinau) and the single-sweep guard, then
   `buildDeps()` reads runtime settings and calls `resolveActiveFilter()` →
   `sources/999md.ts` maps the stored `GenericFilter` to a GraphQL `searchInput`
   (subCategoryId 1406, sale, region/locality, ≤€250k price cap **at source**).

2. **Index.** `sweep.collectIndexStubs()` POSTs `SearchAds` page-by-page through
   the `Fetcher` (8s±2s gap). `parseIndex()` yields `ListingStub[]`
   (id, url, title, EUR-only `priceEur`, `priceRaw`, `areaSqm` from title regex,
   image filenames). Area-over-200 stubs are dropped at parse (area filter id
   still unknown); price is already capped at source.

3. **Diff.** `persist.diffAgainstDb(stubs)` partitions into `new` / `seen`
   (excluded ids filtered out). Detail budget is capped to the per-tick draw
   `targetListingsThisSweep = mean ± jitter`.

4. **Detail.** For each `new` (then `seen`) id, `fetchAdvert(id)` POSTs `GetAdvert`
   (10s detail delay). `parseDetail()` produces `ParsedDetail` — scalar fields,
   geo, author, `rawHtmlHash` (sha256 of {title,state,price,street,body.ro}), and
   `filterValues` triples (filterId=0 placeholder).

5. **Persist.** `persist.persistDetail()` atomically upserts the `Listing`,
   replaces its `ListingFilterValue` rows, and inserts a `ListingSnapshot` **only
   if `rawHtmlHash` changed** vs the latest. Filter-id is resolved via the
   taxonomy LUT; sector via `deriveSector()` (zone-first, heuristic fallback).

6. **Mark / age.** `markSeen(diff.seen)` bumps `lastSeenAt` on every seen stub;
   `markInactiveOlderThan()` flips long-absent rows to `active=false` with a
   `delistedAt`/`delistReason='stale_cutoff'` stamp — **only on `status='ok'`**.
   Backfill + stale-refresh top up enrichment and refresh the long tail.
   `recomputeClusters()` links cross-posts/relistings into canonical lineages.

7. **Analyze.** On an analytics request, `web/routes/analytics.ts` queries the
   catalog (collapsing duplicates by `canonicalId`), builds `SegmentListing[]`,
   fits a ridge-OLS **hedonic** model of `log(price)` on area/rooms/year/sector/
   heating/type, computes `residualPct` per listing, z-scores within cohort, and
   blends residual-z + days-on-market + price-drop into a 0–3 **best-buy score**.

8. **Surface.** The SPA Analytics → Best Buys tab renders the ranked table
   (ScoreBar 0–3); Dashboard shows new-today, price-drops, sweep health, circuit
   state. In parallel, Claude Desktop can hit the MCP `search_listings` /
   `run_sql` tools for the same data, read-only.

---

## Subsystem Index

Each `SPEC-*.md` documents one subsystem; the paired `.feature` is the Gherkin
spec (one `Scenario:` → one `it()`), per CLAUDE.md conventions.

| Spec                                                                                                                       | One-line description                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`SPEC-overview.md`](./SPEC-overview.md)                                                                                   | **This file** — system purpose, architecture, cross-cutting concerns, glossary, reconciliation status.                                     |
| [`SPEC-crawl-pipeline.md`](./SPEC-crawl-pipeline.md) · [`.feature`](./SPEC-crawl-pipeline.feature)                         | Sweep orchestration: cron, tick guards, index pagination, diff, detail fetch, backfill/stale, age-out, circuit, abort, progress.           |
| [`SPEC-parsing.md`](./SPEC-parsing.md) · [`.feature`](./SPEC-parsing.feature)                                              | `parseIndex`/`parseDetail`/`parseTaxonomy`: field normalization, price/area, RO dates, geo/author, hash, filter triples, text-mining.      |
| [`SPEC-persistence-data-model.md`](./SPEC-persistence-data-model.md) · [`.feature`](./SPEC-persistence-data-model.feature) | Prisma data model, atomic upsert + snapshot-on-hash-change, delist events, dedup clustering, sweep bookkeeping.                            |
| [`SPEC-analytics-signals.md`](./SPEC-analytics-signals.md) · [`.feature`](./SPEC-analytics-signals.feature)                | Pure-fn classification, sector inference, hedonic regression, market signals (DOM/absorption), market-temperature index, best-buy scoring. |
| [`SPEC-filter-taxonomy.md`](./SPEC-filter-taxonomy.md) · [`.feature`](./SPEC-filter-taxonomy.feature)                      | Generic filter ↔ 999.md opaque id space; two-tier taxonomy JSON; resolver, label LUT, Setting bounds checks.                               |
| [`SPEC-sources.md`](./SPEC-sources.md) · [`.feature`](./SPEC-sources.feature)                                              | Pluggable source abstraction; `999md` adapter `resolve()`; registry; fallback semantics; `UnknownGenericFilterValueError`.                 |
| [`SPEC-web-api.md`](./SPEC-web-api.md) · [`.feature`](./SPEC-web-api.feature)                                              | Hono operator API: listings/sweeps/analytics/settings/filter/sources/circuit routes, SSE, manual/smoke sweep triggers.                     |
| [`SPEC-web-spa.md`](./SPEC-web-spa.md) · [`.feature`](./SPEC-web-spa.feature)                                              | Vite+React18+Tailwind4 SPA: 6 pages, FilterRail, sortable tables, session-scoped filters, TanStack Query.                                  |
| [`SPEC-mcp-server.md`](./SPEC-mcp-server.md) · [`.feature`](./SPEC-mcp-server.feature)                                     | Read-only MCP server: curated Prisma tools + guarded `run_sql`, RO DB role, schema resource, error scrubbing.                              |
| [`SPEC-operations.md`](./SPEC-operations.md) · [`.feature`](./SPEC-operations.feature)                                     | Politeness budget, capture-session (Playwright/Firefox), Docker Compose, circuit, settings, runbooks.                                      |

---

## Cross-Cutting Concerns

### Politeness budget (non-negotiable)

Owned by `fetch.ts` + `circuit.ts`, defaulted in `config.ts::POLITENESS`,
runtime-tunable via `Setting` (`politeness.*`). 8s base ± 2s jitter between
**all** requests, concurrency 1, Firefox-on-Linux UA, no cookies, 10s on detail
fetches, 5xx backoff `[10s,30s,90s]`. The Fetcher keeps a **single shared
`lastRequestAt` clock** spanning index and detail — only the literal first
request of the instance is free, so the first detail fetch still pays the full
detail delay. The `text/html`-on-GraphQL guard (CAPTCHA interstitial) is
hardcoded for every POST. (SPEC-crawl-pipeline §2, SPEC-operations §politeness.)

### Price normalization

~90% of houses are EUR. `parseDetail`/`parseIndex` store **`priceRaw` always**
(audit) and set `priceEur` **only when the unit normalizes to EUR**; MDL/USD/
unknown → `priceEur=null`. The €250k cap is a **source-side GraphQL filter**
(filterId 9441), not a parser concern — parsers store every price verbatim.
(SPEC-parsing §price, SPEC-operations Invariant 8.)

### Taxonomy / region semantics

999.md's `filterId → featureId → optionId` space is opaque and shifts per
category redesign — never guessed, only captured from a live browser session.
The crawl filter uses **feature 8 ("Localitate")** for region scope, NOT feature
7 — the "240 vs 482" regression guard. Detail parse reads `city.value` (district),
`zone.value` (feature 9 intra-city zone); `sector` is derived **zone-first**, with
a strict diacritic-sensitive `=== 'Chișinău'` gate and a keyword/gazetteer
heuristic fallback. (SPEC-filter-taxonomy, SPEC-analytics-signals §sector.)

### Circuit breaker

Sentinel-file (`/data/.circuit_open`, absolute) survives process restarts;
`failureCount` is process-local. Three consecutive non-404 4xx → open 24h; 403/429
or HTML-on-GraphQL → open immediately. 404 is neutral (neither counted nor reset).
Auto-clears by mtime after 24h; manual clear deletes the sentinel or hits the UI
button. (SPEC-crawl-pipeline §3, SPEC-operations.)

### Timezone

`TZ=Europe/Chisinau` in Dockerfile + compose so Postgres naive datetimes, cron,
quiet hours, and `parseRoDate()` align with local time. **Deliberate divergence:**
`lib/listing-text.ts` posting-hour/weekend math uses `getUTCHours`/`getUTCDay`
(UTC), and analytics month-bucketing + `stats/new-per-day` use UTC arithmetic to
avoid local-midnight skew. (SPEC-parsing Invariant 4, SPEC-web-api §time-bucket.)

### Testing strategy

Testing-trophy: integration > unit > edge. Postgres via **testcontainers per
test file**; `undici` mocked via **`MockAgent`** — never hit 999.md. Fixtures in
`src/__tests__/fixtures/*.html|*.json`, refreshed by `capture-session.ts`. Pure
analytics libs (`src/lib/*`) are I/O-free and fast. Coverage target 70% on
business logic. Gherkin `.feature` files are documentation only (no cucumber).
(CLAUDE.md, `.claude/rules/tdd-workflow.md`.)

### Conventions

Node 22 + TS strict ESM (`.js` extensions on relative imports), Conventional
Commits with scoped prefixes, `feature/`-`fix/` branches squash-merged. Settings
are dot-namespaced JSON in the `Setting` table with `config.ts` fallbacks. Hono
`/api/*` and SPA share one origin (no CORS). Auth/TLS are out of scope.

---

## Glossary

- **Sweep** — one crawl pass: index pagination → diff → detail fetch → persist →
  mark/age, recorded as a `SweepRun` row (`status` ok/partial/failed/circuit_open/
  cancelled; the in-flight literal `'in_progress'` is outside the `SweepStatus` union).
- **Tick** — one cron firing; runs at most one sweep (guarded by quiet hours +
  single-sweep concurrency).
- **Snapshot** — a `ListingSnapshot` row capturing `priceEur`/`description`/
  `rawHtmlHash` at a point in time. Written **only when `rawHtmlHash` changes**, so
  flat prices and bump-only edits add no row (content-addressed history).
- **markSeen** — bulk-bumps `lastSeenAt` (+ revives, + refreshes images) on **all**
  seen stubs, not the cap-sliced subset; never touches `lastFetchedAt`.
- **Sector / Zone** — _Zone_ is 999.md's structured intra-city value (feature 9,
  e.g. "Rîșcani"); _Sector_ is our derived Chișinău city-sector (Centru, Botanica,
  …, 9 values) — zone-preferred, heuristic fallback, null for communes.
- **Hedonic index** — ridge-OLS regression of `log(price)` on
  area/rooms/yearBuilt/one-hot(sector,heating,type); `residualPct =
(actual−predicted)/predicted` is the mispricing signal.
- **DOM (days-on-market)** — `realizedDomDays` = floor((delistedAt−firstSeenAt)/day),
  clamped ≥0, null while active; `medianDomClosed` over delisted cohort members.
- **Best-buy** — a listing scored high (0–3) by blending residual-z (cheap for its
  cohort) + DOM-z + price-drop flag; surfaced on the Analytics → Best Buys tab.
- **Circuit sentinel** — the `/data/.circuit_open` file whose existence + mtime is
  the cross-tick circuit-breaker state.
- **Delist event** — `delistedAt`/`delistReason` stamp set when `active` flips
  true→false (`stale_cutoff`) or backfilled (`backfill_estimate`); cleared on
  revival. Signals inventory absorption, NOT a "sold" confirmation (999.md never
  says why a listing vanished).
- **Backfill / Stale-refresh** — post-budget rotation phases: backfill enriches
  `filterValuesEnrichedAt IS NULL` rows; stale-refresh re-fetches the oldest
  `lastFetchedAt` (watchlist first) to keep the long tail current.
- **Canonical / dedup cluster** — `canonicalId` points each cross-post/relisting to
  its earliest-seen sibling; unique inventory = `COUNT(DISTINCT COALESCE(canonicalId,id))`.

---

## Reconciliation status

The subsystem specs were authored independently and disagreed on ~10 contracts.
Those discrepancies have been **resolved in favor of the real code** — the prose,
diagrams, and data-flow above already reflect the source-of-truth shapes below.
Where a draft spec still carries an older variant, the table's "Reality" column
wins.

| Contract                     | Reality (source of truth)                                                                                                                                             | Note                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence layer shape      | `class Persistence` in `src/persist.ts` (methods, not free functions)                                                                                                 | Constructed with the Prisma client; all persist ops are instance methods.                                                              |
| `diffAgainstDb` return       | `{ new, seen }` — **no `gone` key**                                                                                                                                   | Two-set partition only; the empty-input branch returns before touching Prisma.                                                         |
| Age-out path                 | `markInactiveOlderThan(ageMs)` (separate, one positional arg)                                                                                                         | Stamps `active=false`, `delistedAt`, `delistReason='stale_cutoff'`; never part of the diff.                                            |
| `persistDetail` signature    | `persistDetail(detail)` — **exactly one arg** (the `ParsedDetail`)                                                                                                    | The stale three-arg `(id, parsed, snapshot)` form is wrong.                                                                            |
| Sweep defaults (`config.ts`) | `targetListingsPerSweep=700`, `backfillPerSweep=30`, `staleRefreshPerSweep=50`, `expectedPerDay=2`, `staleThresholdHours=168`, `maxPagesPerSweep=50`, `mode='legacy'` | `FILTER`/`SWEEP` in `config.ts` are authoritative; the smaller `100/5/10/24/20` set is obsolete.                                       |
| Watchlist toggle             | `PUT /api/listings/:id/watchlist` body `{ watchlist }`                                                                                                                | Not `PATCH`, not body key `value`.                                                                                                     |
| Circuit reset                | `DELETE /api/circuit`                                                                                                                                                 | **No** `POST /api/circuit/reset` route exists.                                                                                         |
| Filter endpoints             | `/api/filter` (GET/PUT, + `/sources`, `/taxonomy`) and `/api/filters` (GET) are **distinct**                                                                          | Singular = active filter; plural = facets. Not interchangeable.                                                                        |
| SQL idioms                   | Postgres (`provider="postgresql"`)                                                                                                                                    | Use `now()` / `NOW() - INTERVAL '1 day'`, `active = true`, JSON `->>`. No SQLite `datetime('now')`, `active = 1`, or `julianday(...)`. |

Verified by `src/__tests__/spec-reconciliation.test.ts` (8 passing).

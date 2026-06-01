# Specification: Operator Web API (Hono)

## Purpose & Scope

The Operator Web API is a Hono-based HTTP server (`src/web/server.ts`) that exposes the house-track crawler's state, settings, and control surface to a React SPA operator UI. It mediates access to Postgres-backed crawl data (listings, sweeps, snapshots, configurations) and implements real-time event streaming for in-flight sweep progress. The API does not expose authentication, TLS, or authorization — deployment assumes operator-only local network access or a reverse proxy that handles auth.

---

## Architecture & Key Modules

| File Path                         | Responsibility                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/web/server.ts`               | Hono app factory (`createApiApp()`), router registration, health endpoint                                                                                                                                                                                                                                                                                                                                |
| `src/web/events.ts`               | In-process `EventEmitter` (`sweepEvents`) for sweep lifecycle events; typed interface `SweepEvent`                                                                                                                                                                                                                                                                                                       |
| `src/web/params.ts`               | Request param parsing guards: `optInt()`, `optFloat()`, `positiveIntId()` prevent NaN/invalid data leakage to Prisma                                                                                                                                                                                                                                                                                     |
| `src/web/sweep-status.ts`         | DB-to-UI status translation; collapses `partial`/`failed`/`circuit_open` → `'failed'`                                                                                                                                                                                                                                                                                                                    |
| `src/web/db.ts`                   | A _separate_ PrismaClient singleton (`getPrismaWeb()` / `disconnectPrismaWeb()`). **Note: `server.ts` does NOT use this module** — `createApiApp()` calls `getPrisma()` from the top-level `src/db.js`, and the stub routers (`sweeps.detail`, `sweeps.stream`, `stats`, `listings.feed`, `analytics`) each call `getPrisma()` themselves. `src/web/db.ts` is currently unreferenced by the app factory. |
| `src/web/routes/listings.ts`      | `GET /api/listings`, `/api/listings/facets`, `/api/listings/:id`, `/api/listings/:id/price-history`, PUT watchlist/excluded toggles                                                                                                                                                                                                                                                                      |
| `src/web/routes/listings.feed.ts` | Dashboard "leads" feeds: `GET /api/listings/new-today`, `GET /api/listings/price-drops` (7d, ≥5% drop)                                                                                                                                                                                                                                                                                                   |
| `src/web/routes/analytics.ts`     | Market-analysis routes (router mounted under `/api`): `/analytics/overview`, `/segments`, `/duplicates`, `/sellers`, `/distress`, `/valuation`, `/market-index`, `/best-buys`, `/price-drops`. Filters parsed by a single `parseAnalyticsFilters()` that also accepts `region` as a legacy alias for `district`.                                                                                         |
| `src/web/routes/stats.ts`         | Dashboard widget data: by-district, new-per-day (7d), success-rate, avg-price                                                                                                                                                                                                                                                                                                                            |
| `src/web/routes/sweeps.ts`        | Sweep orchestration: GET list/latest, POST manual/smoke triggers, abort/cancel, errors, smoke assertions                                                                                                                                                                                                                                                                                                 |
| `src/web/routes/sweeps.stream.ts` | `GET /api/sweeps/:id/stream` — Server-Sent Events for live sweep progress (TODO: wire crawler log emitter)                                                                                                                                                                                                                                                                                               |
| `src/web/routes/sweeps.detail.ts` | `GET /api/sweeps/:id` — full sweep detail: config, pages/details log, errors, live progress counters, in-flight URL                                                                                                                                                                                                                                                                                      |
| `src/web/routes/settings.ts`      | `GET /api/settings`, `PATCH /api/settings/:key` — runtime config with validation & defaults                                                                                                                                                                                                                                                                                                              |
| `src/web/routes/filter.ts`        | `GET /api/filter`, `PUT /api/filter` — active filter state & resolution; `/filter/sources`, `/filter/taxonomy`                                                                                                                                                                                                                                                                                           |
| `src/web/routes/filters.ts`       | `GET /api/filters` — available filter facets from MCP layer                                                                                                                                                                                                                                                                                                                                              |
| `src/web/routes/sources.ts`       | `GET /api/sources`, `PATCH /api/sources/:id` — data source registry, politeness/filter overrides per source                                                                                                                                                                                                                                                                                              |
| `src/web/routes/circuit.ts`       | `GET /api/circuit`, `DELETE /api/circuit` — circuit breaker status & manual reset                                                                                                                                                                                                                                                                                                                        |

---

## Data Flow / Control Flow

### Startup Sequence

1. `src/web/server.ts` — `createApiApp()` called at process start; `getPrisma()` (from `src/db.js`, _not_ `getPrismaWeb`) is resolved once and passed to the class-style routers
2. The Prisma singleton lazy-initializes on first query (connection pool blooms on demand)
3. **Router registration order is load-bearing** (server.ts:23–41). The feed/stat/analytics/detail/stream routers are mounted with `app.route('/api', …)` BEFORE `registerListingsRoutes`, so concrete sub-paths (`/api/listings/new-today`, `/api/listings/price-drops`) win the prefix match over the generic `/api/listings/:id`. Reordering would route `new-today` into the `:id` handler and 404.
4. Server binds to `127.0.0.1:3000` via `@hono/node-server`, only when the module is the process entrypoint (the `argv[1]`-vs-`import.meta.url` guard; `import.meta.main` is Bun-only)
5. Health check at `GET /api/health` available immediately, returns `{ status: 'ok' }`

### Typical Request Flow (e.g., GET /api/listings)

1. **Param parsing** — `optInt()`, `optFloat()` decode query string safely
2. **Validation** — reject empty-but-present district param (400)
3. **Query execution** — delegate to `searchListings(prisma, {...filters})` from MCP layer
4. **Response** — JSON serialize, set `Content-Type: application/json` (Hono default)
5. **Error fallback** — Hono catch-all returns 500 if unhandled exception

### Manual Sweep Trigger (POST /api/sweeps)

1. Check `findInProgressSweep()` — reject if one is active. 409 body is `{ error: 'sweep_in_progress', activeSweepId }` (the active id is echoed back).
2. Build `SweepDeps` object: fetcher, circuit, persist, parse functions, politeness/filter settings (read from Postgres at trigger time). `targetListingsThisSweep` is `targetMean ± random(targetJitter)`; `missingThresholdMs` derives from `expectedPerDay`.
3. Create `SweepRun` row with `status='in_progress'` via `persist.startSweep({ source: '999.md', trigger: 'manual' })`
4. **Launch non-blocking** — `void (async () => { try { await runSweep(deps, sweep.id) } catch (e) { console.error(...) } })()` returns immediately; a thrown error inside the async IIFE is swallowed to a `console.error` and never reaches the HTTP client (which already got its 201).
5. Return 201 with `{ id, startedAt }` to client
6. Client polls `GET /api/sweeps/:id` and subscribes to `GET /api/sweeps/:id/stream` for live events
7. Any error _before_ the IIFE (e.g. `buildDeps()` or `startSweep()` throwing) is caught by the route's `try/catch` and returns 500 `{ error: 'Internal server error' }`.

### Smoke Sweep Trigger (POST /api/sweeps/smoke)

Same as manual, with these differences:

- Same single-sweep 409 guard _and_ an additional defensive `circuit.isOpen()` check → 409 `{ error: 'circuit_open' }` if the breaker is open.
- `SweepDeps` is cloned with overrides `maxPagesPerSweep=1`, `targetListingsThisSweep=3`, **`backfillPerSweep=0`, `staleRefreshPerSweep=0`** (smoke does no backfill/stale-refresh work — undocumented previously).
- Row created with `trigger: 'smoke'`. Assertions are NOT run inline; they are computed lazily by `GET /api/sweeps/:id/smoke-assertions`.

### Cancel Sweep (POST /api/sweeps/:id/cancel)

1. `positiveIntId()` guard → 400 `{ error: 'Invalid sweep id' }` on non-positive-int id.
2. 404 `{ error: 'Sweep not found' }` if no row.
3. 409 `{ error: 'Can only cancel running sweeps' }` if `status !== 'in_progress'`.
4. **Two cancel paths:** if an in-memory `AbortController` exists for the id, call `.abort()` and let `runSweep`'s finally block stamp `'cancelled'` (DB NOT updated synchronously by the route). If no controller (e.g. after a process restart that left a stale `in_progress` row), the route updates the DB row to `status='cancelled', finishedAt=now` directly.
5. Returns 200 `{ id, status: 'cancelled' }` in both paths.

### Settings Write & Validation (PATCH /api/settings/:key)

1. Parse JSON body `{ value: unknown }`
2. Look up setting schema (from `src/settings.ts`)
3. Run Zod validation on the value
4. Persist to `Setting.valueJson` if valid. On a `ZodError` → 400 `{ error: 'Validation failed', details }`; on `Error` whose message includes `Unknown setting key` → 400 `{ error: 'Unknown setting key' }`; any other error → 500.
5. Return `{ success: true }`; crawler reads new setting on next sweep start via `getSetting()`
6. **Caveat**: the `c.req.json()` body parse happens _outside_ the route's try/catch (settings.ts:29), so a malformed JSON body is NOT converted to a clean 400 — it falls through to Hono's catch-all (500). (`PUT /api/filter` and `PUT /api/sources/:id` differ: filter guards JSON parse → 400 'Invalid JSON body'.)

### Sweep-Status Progression (in-process and database state)

- **Cron trigger** — `src/index.ts` calls `runSweep()` with `trigger='cron'`
- **Manual trigger** — operator UI calls `POST /api/sweeps` with `trigger='manual'`
- **Smoke trigger** — operator UI calls `POST /api/sweeps/smoke` with `trigger='smoke'` (limited pages)
- **DB state** — status moves `'in_progress'` → `'ok'`|`'partial'`|`'failed'`|`'circuit_open'`|`'cancelled'` in `SweepRun.status`
- **UI translation** — `toUiStatus()` (src/web/sweep-status.ts): `'in_progress'`→`'running'`, `'ok'`→`'success'`, `'cancelled'`→`'cancelled'`, **everything else** (`partial`, `failed`, `circuit_open`, and any unknown string) → `'failed'`. The collapse is intentional so the operator can drill into `errors[]` for detail; an unrecognised DB status defaults to `'failed'`, never throws.

---

## Contracts & Types

### Request Parameters (Query String)

**GET /api/listings:**

- `limit?: number` (default 50)
- `offset?: number` (default 0, clamped ≥0)
- `minPrice?, maxPrice?, minRooms?, maxRooms?: number`
- `minAreaSqm?, maxAreaSqm?, minLandAre?, maxLandAre?: float`
- `minFloors?, maxFloors?: number`
- `district?: string` — comma-separated or repeated `?district=A&district=B`; rejects empty (400)
- `sector?: string` — comma-separated or repeated; rejects empty (400)
- `sort?: 'newest' | 'price' | 'eurm2'`
- `type?: string` — derived from title regex (e.g., `'house'`, `'villa'`)
- `q?: string` — full-text search on title (case-insensitive)
- `flags?: string` — reserved for future UI filtering
- `firstSeenAfter?, lastFetchedAfter?: ISO8601 string`
- `favorite?: 'true'` → restrict to `watchlist=true`
- `includeExcluded?: 'true'` → include `excluded=true` rows (default: exclude them)

**GET /api/analytics/{overview,segments,distress,valuation,market-index,best-buys,price-drops}:**

- All listing filters above, parsed by `parseAnalyticsFilters()`. `region` is accepted as a legacy alias for `district` (analytics.ts:161). Same present-but-empty `district`/`sector` → 400 rule.
- `minRooms?, maxRooms?: number` range takes precedence over legacy single `rooms` exact-match.
- `/analytics/segments` only: `by?: string` — comma list, subset of `sector,rooms,priceBand,month` (default `sector,rooms,priceBand`); empty or any invalid token → 400 `invalid by dimensions: ...`.
- `/analytics/price-drops` only: `period?: '7d'|'30d'|'90d'` (default `30d`); anything else → 400 `invalid period`.
- `/analytics/duplicates` and `/analytics/sellers` take NO filters — they read the whole catalog (`canonicalId != null` / `authorId != null`).

### Endpoint Response Shapes (selected, where they diverge from the obvious)

**GET /api/sweeps/:id (sweeps.detail.ts):** returns `{ id, status (UI status), startedAt, finishedAt?, source (default '999.md'), trigger (default 'cron'), config (=configSnapshot ?? {}), summary, pages, details, errors, logTail (=eventLog ?? []), progress, currentlyFetching }`. `summary` carries live counters (`pagesFetched/detailsFetched/newListings/updatedListings/errors/durationMs`). `progress` = `{ phase, pagesDone (=detailsFetched), pagesTotal (configSnapshot['sweep.detailsTotal'] ?? max(detailsFetched,1)), detailsDone, detailsQueued, newCount, updatedCount, queued (legacy 0) }`. `detailsQueued` and `currentlyFetching` are non-zero/non-null ONLY when `status==='in_progress'` AND the in-memory `getActiveSweepId()` matches this row; after a process restart they fall back to 0 / null even though the DB row is still `in_progress`. Invalid id → 400 `{ error: 'Invalid sweep ID' }` (note: capital "ID" here, differs from other routes); missing row → 404 `{ error: 'not found' }` (lowercase, differs from `'Sweep not found'` elsewhere).

**GET /api/analytics/valuation:** insufficient-sample response is `{ n, minSamples: 10, insufficientData: true, rSquared: null, deals: [], overpriced: [] }`. Sufficient: `{ n, rSquared, coefficients, deals (≤20, most underpriced first), overpriced (≤20, most overpriced first) }`. `deals`/`overpriced` are slices of the same residual-sorted list.

**GET /api/analytics/duplicates:** array of `{ canonicalId, canonical, duplicates[], size }` sorted by size desc; `canonical` may be `null` if the canonical row isn't in the catalog.

**GET /api/analytics/sellers:** array of `{ authorId, authorName, listings, activeListings, sellThrough }` sorted by listings desc. Sparse until author identity is captured.

**GET /api/analytics/distress:** `{ activeCount, distressedCount, distressShare, signalBreakdown (per DISTRESS_LEXICON category), closedCount, weekendDelistShare, postingHour }`.

**GET /api/analytics/market-index:** `marketTemperature(components)` output; sectors with `< MARKET_INDEX_MIN_ACTIVE (5)` active listings are dropped before scoring.

---

## Invariants & Business Rules

### Sweep Orchestration

1. **Single-sweep mutual exclusion**: `POST /api/sweeps` returns 409 if one is already `in_progress`
2. **Non-blocking execution**: Manual & smoke sweeps return immediately; client polls/streams for completion
3. **Smoke tests are capped**: `SMOKE_MAX_PAGES=1`, `SMOKE_TARGET_LISTINGS=3`
4. **Abort signal propagation**: tracked via `getSweepAbortControllers()`

### SSE Streaming (GET /api/sweeps/:id/stream)

1. **Headers set explicitly** (not Hono defaults): `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
2. **First write is an initial comment** `: connected to <id>\n\n` to flush headers immediately (undocumented previously).
3. **Heartbeat** `: ping\n\n` every 15s while alive.
4. **Per-event filtering**: only events whose `String(ev.sweepId) === id` (string compare; the path param is coerced with `String()`) are forwarded. The forwarded payload **strips `sweepId`** (`const { sweepId, ...payload }`) — clients receive `{ t, lvl, msg, meta? }`, not the id.
5. **Liveness loop**: holds the connection open with a 1s `setTimeout` poll loop; `s.onAbort()` flips `alive=false`, after which the loop exits, the heartbeat interval is cleared, and the emitter listener is unsubscribed via the returned `off()`.
6. **Currently a no-op stream of events** — `events.ts` has a TODO; nothing in the crawler calls `sweepEvents.emitEvent()` yet, so only the initial comment + heartbeats are emitted in practice.

### Settings & Configuration

1. **Lazy-loaded at trigger time**: Crawler reads settings from Postgres when a sweep starts
2. **Zod validation is required**: Invalid values rejected with 400 + details
3. **Defaults live in `src/config.ts`**: `getSetting(key, defaultValue)` returns default if not in DB

### Listings & Filters

1. **District param is strict**: `?district=` (empty) returns 400
2. **Type derivation is JS-side**: regex on title; facets computed in-memory post-fetch
3. **Excluded rows are hidden by default**: `includeExcluded` toggles them back in
4. **Watchlist priority**: Crawler prioritizes flagged rows in refresh rotation
5. **Dedup clusters**: `canonicalId` points to earliest-seen listing; analytics collapse for unique count
6. **Facets are computed over `active && !excluded` rows only** (listings.ts:93–177): districts (distinct), price/rooms/area/landAre/floors min-max, distinct-title-derived `types`, `sectors` grouped+counted, `roomsValues` distinct, plus `favoritesCount`/`excludedCount`/`mislabeledCount`. `municipality` and `sectors` keys are **omitted entirely when empty** (not `[]`). `excludedCount` counts `active && excluded` rows.
7. **Mutation body validation**: `PUT /api/listings/:id/watchlist` requires `{ watchlist: boolean }`, `/excluded` requires `{ excluded: boolean }`; a missing/non-boolean field → 400 `{ error: 'Body must be { watchlist: boolean }' }` (resp. excluded). A non-existent listing surfaces as a thrown Persistence error caught → 404 `{ error: 'Listing not found' }`.
8. **Price-history**: `GET /api/listings/:id/price-history` returns `{ points }`; a null result (listing not found) → 404 `{ error: 'Listing not found' }`.

### Analytics Slices

1. **Filter consistency**: All analytics parse same `AnalyticsFilters` (district, sector, rooms, price, area, type, favorite, includeExcluded)
2. **Type filtering is post-fetch**: Type applied in-memory after SQL query
3. **Closed (delisted) listings included** in segments/overview when computing realized DOM
4. **Market-index min-samples**: Sectors below `MARKET_INDEX_MIN_ACTIVE=5` suppressed
5. **Valuation model requires ≥10 samples**: Respond `{ insufficientData: true }` if fewer

### Circuit Breaker

1. **Manual reset only**: Operator deletes `data/.circuit_open` or calls `DELETE /api/circuit`
2. **Smoke test defense**: Checks `circuit.isOpen()` defensively before running
3. **Status check**: `GET /api/circuit` reads file mtime for `openedAt` timestamp; returns `{ open, openedAt, sentinelPath: 'data/.circuit_open' }`. If the file vanishes between the `existsSync` check and `fs.stat`, `openedAt` stays `null` (race swallowed).
4. **DELETE responses**: deleting an existing sentinel → 200 `{ success: true, message: 'Circuit breaker cleared' }`; already-closed → 200 `{ success: true, message: 'Circuit breaker was already closed' }`; an `ENOENT` race during unlink → 404 `{ success: true, message: 'Sentinel not found' }`; other errors → 500 `{ error: 'Failed to clear circuit breaker' }`. The sentinel path is hard-coded as the relative string `'data/.circuit_open'` in this route (circuit.ts:5), not read from `CIRCUIT.sentinelPath` — so it resolves against the process CWD.

### Filter & Source Management

1. **PUT /api/filter** validates `body.generic ?? body` against `genericFilterSchema`; failure → 400 `{ error: 'Validation failed', details: [{ path, message }] }`. Invalid JSON body → 400 `{ error: 'Invalid JSON body' }`. After persisting, `resolveActiveFilter()` runs; an `UnknownGenericFilterValueError` (value not in source mapping) → 400 `{ error: 'Unknown <field> value "<v>" — not in source mapping', details: [...] }`.
2. **GET /api/filter** and the PUT success response both return `{ generic, sources: [{slug,name,active}], resolved: { searchInput }, sourceSlug }`.
3. **GET /api/filter/taxonomy** maps category → subCategoryId (`house→1406`, `apartment→1404`); unknown/invalid category → 400 `{ error: 'Unknown category "<x>"' }`; absent/empty category falls back to the active filter's category.
4. **GET /api/filters** (plural — distinct from singular `/api/filter`) is read-only introspection of the _observed_ filter universe, not the active config. It calls `listFilters(prisma)` (`src/mcp/queries.ts`), which scans `ListingFilterValue` rows (`optionId NOT NULL`), groups by `(filterId, featureId)`, and returns `FilterGroup[]`: `{ filterId, featureId, optionIds[], sampleListingIds[] (≤ SAMPLE_LIMIT), listingCount, filterLabel, featureLabel, optionLabels }`. Groups are sorted by `listingCount` desc; rows with no taxonomy match fall through with `filterLabel`/`featureLabel = null` so the response stays stable when 999.md adds new groups before the next capture. No request body, no error path beyond a DB failure.
5. **PATCH /api/sources/:id**: invalid id → 400 `{ error: 'Invalid source id' }`. `enabled` non-boolean → 400 `{ error: 'enabled must be a boolean' }`. `politenessOverridesJson` validated against a `.partial().strict().nullable()` schema (rejects unknown keys, e.g. `__proto__`); `filterOverridesJson` against `genericFilterSchema.nullable()`; invalid → 400 with `details: error.issues`. Prisma "not found"/"No Source" → 404 `{ error: 'Source not found' }`. Success returns only `{ id, slug, enabled }` (not the full row).
6. **GET /api/sources** sets `placeholder: adapterKey !== '999md'` per row.

---

## Edge Cases & Failure Modes

### Request Parsing

- **NaN leakage**: `optInt()`/`optFloat()` return `undefined` on NaN/empty, checked before Prisma. `positiveIntId()` returns `null` unless the value is an integer `> 0` (rejects `0`, negatives, floats, non-numerics). Analytics routes use their own inline `int()`/`float()` parsers (not the `params.ts` helpers) but apply the same NaN→undefined rule.
- **Empty district / sector param**: 400 if the comma/repeat-split result is empty (`?district=`, `?district=,,,`, `?district=%20`) — applies to both `/api/listings` and all analytics routes.
- **Invalid sweep id**: 400 before Prisma query. Note the message inconsistency: `sweeps.ts` & `sources.ts` use `'Invalid sweep id'` / `'Invalid source id'`; `sweeps.detail.ts` uses `'Invalid sweep ID'` (capital ID) and validates inline with `parseInt`+`Number.isInteger(id) && id>0` rather than `positiveIntId()`.
- **Concurrent setting writes**: Last write wins (acceptable for runtime config)
- **`GET /api/sweeps/latest` with no sweeps**: 404 `{ error: 'No sweeps found' }`.
- **`GET /api/sweeps/:id/errors`**: 400 invalid id / 404 `{ error: 'Sweep not found' }` / non-array `errors` column coerced to `[]`; unhandled error → 500 `{ error: 'Internal server error' }`.
- **`GET /api/sweeps/:id/smoke-assertions`**: 400 invalid id; 404 if missing; 409 `{ error: 'Not a smoke sweep' }` if `trigger !== 'smoke'`; `{ pending: true, sweepId }` while `finishedAt` is null; otherwise `{ sweepId, durationMs, passed, assertions }` (assertions window starts 1s before `startedAt`, `minListingsTouched: 1`).
- **`durationMs` for in-flight rows**: `/api/sweeps` list and `/api/sweeps/:id` compute `durationMs = now - startedAt` when `finishedAt` is null, so a running sweep shows growing elapsed time.

### Sweep Execution

- **Abort during fetch**: Fetcher catches `AbortError`, sweep marks as `'cancelled'`
- **Abort after finished**: Signal fires but loop has exited; no-op (correct)
- **In-memory state lost on crash**: `getActiveSweepId()` returns null; `currentlyFetching` returns null
- **Circuit open during smoke**: Defensively checks breaker before running

### Analytics Queries

- **No listings match filter**: Empty `rows[]`, aggregates 0/null; UI renders "no results"
- **Null price/area prevents median**: `validForMedian` requires `priceEur != null && areaSqm != null && areaSqm > 0`; if none, hedonic model returns null and `median([])`-style helpers must tolerate empty input.
- **Snapshot time-bucket boundary**: month buckets use UTC (`Date.UTC`, `toLocaleString` month labels); `stats/new-per-day` deliberately uses UTC-day arithmetic on both DB (`date_trunc('day')`) and JS (`setUTCDate`) to avoid a one-day skew at the local-midnight boundary. Postgres container `TZ=Europe/Chisinau` only affects naive timestamps.
- **`buildListingWhere` invariant**: throws `TypeError('AnalyticsFilters.districts must be an array')` if `districts` is not an array (defensive guard, analytics.ts:221).
- **Closed-slice branches**: `segments`/`overview`/`distress`/`market-index` re-query with `active:false, delistedAt != null` (or, for segments, `OR: [{active:true},{delistedAt:{not:null}}]` after deleting the `active` constraint) so realized DOM / absorption / gone-per-week have data.
- **Type filter is always post-fetch** (`applyTypeFilter` over `deriveType(title)`) on every analytics route — never in the Prisma `where`.
- **Price-drops feed vs analytics**: the dashboard `/api/listings/price-drops` (listings.feed.ts) uses a **≥5%** drop over a fixed **7-day** window (`dropRatio <= 0.95`), requires ≥2 in-window snapshots, and is `active`-only with no other filters; the analytics `/api/analytics/price-drops` uses **≥3%** over a selectable `period` and honors the full filter slice. The two endpoints share neither threshold nor window.
- **Empty active set short-circuits snapshot sub-queries**: overview skips the `snapshots`/velocity queries entirely when `activeIds.size === 0` (avoids an `IN ()` query).

---

## Configuration & Operational Notes

### Environment Variables

- `DATABASE_URL` — Postgres connection string (required)
- `NODE_ENV` — `'production'` or `'development'`

### Setting Keys (Prisma `Setting.key`)

| Key                            | Type   | Default            |
| ------------------------------ | ------ | ------------------ |
| `politeness.baseDelayMs`       | number | 8000               |
| `politeness.jitterMs`          | number | 2000               |
| `politeness.detailDelayMs`     | number | 10000              |
| `sweep.maxPagesPerSweep`       | number | 50                 |
| `sweep.backfillPerSweep`       | number | 30                 |
| `sweep.staleRefreshPerSweep`   | number | 50                 |
| `sweep.targetListingsPerSweep` | number | 700                |
| `sweep.targetListingsJitter`   | number | 130                |
| `sweep.expectedPerDay`         | number | 2                  |
| `stats.successRateWindow`      | number | 100                |
| `filter.generic`               | JSON   | (defaults in code) |

### HTTP Headers

**JSON routes (Hono `c.json` default):**

- `Content-Type: application/json`

**SSE route (`/sweeps/:id/stream`, set explicitly in code — NOT Hono defaults):**

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no` (disable nginx buffering)

### Deployment Notes

1. **Single instance**: `sweepEvents` EventEmitter (max 50 listeners) and `getSweepAbortControllers()` are instance-scoped, as is `getActiveSweepId()`/`getQueueDepth()`/`getCurrentlyFetching()` in-memory sweep state. A process restart loses all of this; DB `in_progress` rows then surface with `detailsQueued: 0`, `currentlyFetching: null`, and can only be cancelled via the no-controller DB-update path.
2. **Reverse proxy**: Expect auth/TLS enforcement upstream
3. **Postgres pool**: `getPrisma()` lazy-initializes; defaults CPU count × 2. `src/web/db.ts` exposes a _second_ client factory (`getPrismaWeb`/`disconnectPrismaWeb`) that the server does not currently wire up.
4. **Signal handling**: No explicit graceful-shutdown; relies on container orchestrator. `disconnectPrismaWeb()` exists but is never called by the server.

---

## Acceptance Criteria

1. ✅ Server initializes on `127.0.0.1:3000` and responds to `GET /api/health` with `{ status: 'ok' }`
2. ✅ `GET /api/sweeps` paginates SweepRun records with configurable limit/offset
3. ✅ `POST /api/sweeps` enforces single-sweep mutual exclusion (409 if one is active)
4. ✅ `GET /api/sweeps/:id/stream` opens Server-Sent Events, emits heartbeat every 15s
5. ✅ `GET /api/listings` accepts multi-faceted filters (price, rooms, area, district, sector, type, text-search)
6. ✅ `PUT /api/listings/:id/watchlist` and `/excluded` toggle flags and persist
7. ✅ `GET /api/listings/facets` returns filter-rail data
8. ✅ `GET /api/analytics/overview` computes market KPIs respecting active-listings filter
9. ✅ `GET /api/settings` lists all setting keys with values, defaults, schemas
10. ✅ `PATCH /api/settings/:key` validates Zod schema, persists, returns 400 on error
11. ✅ `GET /api/filter` and `PUT /api/filter` manage active filter state
12. ✅ `GET /api/sources` and `PATCH /api/sources/:id` list/update source configs
13. ✅ `GET /api/circuit` and `DELETE /api/circuit` report and clear circuit-breaker
14. ✅ Param parsing prevents NaN leakage; empty district param rejected with 400
15. ✅ Settings read at sweep-trigger time from Postgres; defaults fall back to `src/config.ts`
16. ✅ All analytics routes consistently parse and apply filter slice
17. ✅ Smoke sweep (`POST /api/sweeps/smoke`) capped at 1 page, 3 detail targets, defensively checks circuit
18. ✅ Smoke assertions endpoint (`GET /api/sweeps/:id/smoke-assertions`) computes pass/fail once sweep finishes

---

## Open Questions / Known Gaps

### Task 1 (In Progress)

- **SSE event wiring**: Crawler has no code path that calls `sweepEvents.emitEvent({...})` (the typed helper) / `sweepEvents.emit('event', {...})`. Pino transport or manual log hook in `runSweep()` needed. Until then `/sweeps/:id/stream` only emits the initial `: connected` comment and 15s `: ping` heartbeats.

### Phase 1 (Not in this slice)

- **Auth/TLS**: API assumes operator-only local network access.
- **Pluggable source adapters**: Only `999md` implemented; P2 work for makler.md, lara.md.
- **Cron reschedule hot-reload**: Crawler needs manual restart.
- **Graceful shutdown**: No explicit connection drain; relies on container orchestrator.

### Phase 2 (Deferred)

- **Geo-dedup**: `Listing.lat`/`Listing.lon` not populated; needs ParseDetail.mapPoint extraction.
- **Seller identity**: `authorId`, `authorName`, `authorType` not populated; needs GraphQL extension.
- **Redis pub/sub for SSE**: Current in-memory emitter is instance-scoped.
- **Real-time filter updates**: Crawler only reads on sweep start.

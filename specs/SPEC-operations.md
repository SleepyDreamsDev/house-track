# Operations: Politeness, Capture-Session, Deployment

## Purpose & Scope

This specification describes the operational subsystem that governs how the house-track crawler behaves in production: the politeness constraints that prevent IP bans, the manual capture-session workflow to refresh GraphQL queries and headers when the remote schema drifts, and the Docker Compose deployment model with circuit breaker, settings persistence, and real-time operator UI. The subsystem ensures the crawler looks like a human browser, fails gracefully under transient errors, and allows runtime tuning without code changes.

## Architecture & Key Modules

| File Path                        | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                   | Cron entrypoint; bootstraps `PrismaClient`, settings resolver, fetcher/circuit/persistence deps; schedules hourly ticks; runs API server on `127.0.0.1:3000`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/config.ts`                  | Hardcoded defaults: `POLITENESS` (8s±2s gap, Firefox UA, Accept-Language), `CIRCUIT` (3 consecutive failures → 24h pause), `SWEEP` (backfill caps), `FILTER` (GraphQL search input)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/fetch.ts`                   | `Fetcher` class: enforces inter-request delay with jitter, retries 5xx with backoff (10s/30s/90s), trips circuit on 403/429, POSTs GraphQL with same-origin-XHR headers                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/circuit.ts`                 | `Circuit` class: sentinel-file (default `/data/.circuit_open` — absolute path, `CIRCUIT.sentinelPath` in `src/config.ts:91`) tracks breaker state across cron ticks; `isOpen()` checks mtime; `recordFailure()` increments counter and opens on threshold                                                                                                                                                                                                                                                                                                                                               |
| `src/sweep.ts`                   | `runSweep()` orchestrates per-tick flow: pre-flight circuit check → collect index stubs → diff against DB → fetch+parse+persist details → mark seen/inactive → close `SweepRun` row                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/settings.ts`                | `getSetting()` reads from `Setting` table; falls back to `config.ts` defaults; keys namespaced: `politeness.baseDelayMs`, `sweep.maxPagesPerSweep`, etc.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/log.ts`                     | `pino` logger; JSON output to stdout; per-sweep `EventEmitter` for SSE broadcasts to the operator UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Dockerfile`                     | Multi-stage Node 22 build; applies `TZ=Europe/Chisinau`; runs `prisma migrate deploy && node dist/index.js` at boot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docker-compose.yml`             | Postgres 16 + Node service + read-only role; health checks; `DATABASE_URL` injected; volumes for data persistence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `scripts/capture-session.ts`     | Playwright-driven Firefox browser; intercepts GraphQL POSTs to extract real query bodies, headers, fixtures, **and the filter-taxonomy op** (3rd capture); writes to `src/graphql.ts` (`SEARCH_ADS_QUERY`, `GET_ADVERT_QUERY`, `FILTER_TAXONOMY_QUERY`), `.env.local` (cookies), fixtures, `src/data/filter-taxonomy.1406.json`. Falls back to a direct GraphQL probe + introspection when GetAdvert is SSR'd (not fired client-side). Hard-required: SearchAds + GetAdvert. Taxonomy is best-effort — a **partial** capture (no taxonomy) still writes all other artefacts and exits 0 with a warning. |
| `scripts/verify-robots.ts`       | Fetches `robots.txt`; checks that `/graphql`, `/ro/list/real-estate/houses-and-villas`, and `/ro/103772337` are allowed for `User-agent: *`. The robots parser (`scripts/lib/robots.ts`) is **disallow-only** — it has NO `Allow:` rule support and is not a full RFC 9309 implementation.                                                                                                                                                                                                                                                                                                              |
| `scripts/backfill-filter-ids.ts` | Updates pre-existing `ListingFilterValue` rows with `filterId=0` using captured taxonomy LUT; idempotent; merges bootstrap (`bootstrapLutFromConfig` in `src/parse-taxonomy.ts`) + captured fixture at `src/data/filter-taxonomy.1406.json`. Supports `--dry-run`.                                                                                                                                                                                                                                                                                                                                      |
| `docs/capture-session.md`        | Runbook: how to manually bootstrap cookies, capture SearchAds/GetAdvert queries, headers, and fixtures when schema drifts; includes 8 steps                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `docs/operator-ui.md`            | UI console guide: Dashboard (sweep status, circuit breaker, in-app analytics), Houses (searchable table), Sweeps (job history + reset button), Settings (tunable crawler knobs)                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Data Flow / Control Flow

### Per-Cron-Tick (Sweep Execution)

1. **Bootstrap** (`src/index.ts`):
   - Read `sweep.cronSchedule` from `Setting` table (or default `0 9,21 * * *`).
   - Schedule cron job with `node-cron`.
   - On each tick (with optional jitter offset), invoke `tick()`.

2. **Quiet Hours Check**:
   - Read `sweep.quietHoursStart` / `sweep.quietHoursEnd` from `Setting` (default no quiet hours).
   - If current hour (Europe/Chisinau TZ) is in quiet range, skip tick.

3. **Single-Sweep Guard** (`sweep.findInProgressSweep()`):
   - Query `SweepRun` table for any row with `status='in_progress'`.
   - If found, skip tick (phantom rows from crashed prior ticks require manual cleanup via `/api/sweeps/:id/cancel`).

4. **Build Dependencies** (`index.ts: buildDeps()`):
   - Instantiate `Circuit` with sentinel path, threshold, pause duration from config.
   - Instantiate `Fetcher` with runtime-mutable politeness settings (baseDelayMs, jitterMs from `Setting` table).
   - Resolve active filter via `resolveActiveFilter()` (reads `Source` + `Setting` rows; falls back to hardcoded `FILTER.searchInput`).
   - Build callbacks: `fetchSearchPage(pageIdx)`, `fetchAdvert(id)` wrap `fetcher.fetchGraphQL()`.

5. **Run Sweep** (`sweep.runSweep()`):
   - **Pre-flight**: Check `circuit.isOpen()`. If true, log skip, write `SweepRun` with `status='circuit_open'`, return.
   - **Create** `SweepRun` row with `status='in_progress'`, `startedAt=now()`.
   - **Collect index stubs**:
     - For each page 0..N (until `maxPagesPerSweep` or empty result):
       - Call `fetchSearchPage(pageIdx)` (applies 8s±2s base delay + optional override).
       - On 403/429: circuit trips → throw `CircuitTrippingError`.
       - On 5xx: retry with backoff (10s, 30s, 90s).
       - Parse response with `parseIndex()` → extract `[{id, url, title, priceEur, postedAt}, ...]`.
       - Store in `allStubs` array.
   - **Diff against DB**:
     - Call `persist.diffAgainstDb(allStubs)` → returns `{ new, seen }` sets (no `gone` key; delisting is handled by `markInactiveOlderThan()` below).
   - **Fetch+persist details**:
     - For each `id` in `new` (capped by `targetListingsThisSweep`):
       - Call `fetchAdvert(id)` (applies 10s detail delay instead of 8s base).
       - Parse response with `parseDetail(id, json)` → extract full schema fields.
       - Call `persist.persistDetail(parsed)` (single `ParsedDetail` arg) → upsert `Listing` + insert `ListingSnapshot` if hash changed.
     - Similarly process `backfillPerSweep` oldest unenriched listings + `staleRefreshPerSweep` oldest fetched.
   - **Mark seen & aged-out**:
     - Call `persist.markSeen(seenIds)` → update `lastSeenAt` on stubs that appear in current index.
     - Call `persist.markInactiveOlderThan(missingThresholdMs)` → set `active=false` on listings missing for 3+ consecutive sweeps.
   - **Close sweep**:
     - Call `persist.finishSweep(sweepId, result)` → set `status='ok'|'partial'|'failed'`, `finishedAt`, `pagesFetched`, `detailsFetched`, `newListings`, `updatedListings`, `errors`.

6. **Error Handling**:
   - Unhandled exceptions in `tick()` are logged but do NOT kill the process; the cron scheduler remains active for the next tick.
   - Circuit `recordFailure()` increments in-process counter; at threshold, opens sentinel file (survives process restart).
   - Individual listing parse errors log but continue the sweep; schema drift is recorded as partial in `SweepRun.errors`.

### Politeness Enforcement (Fetcher)

1. **Inter-request Delay** (`fetch.ts: maybeWaitBetweenRequests()`):
   - Track `lastRequestAt` as module-level timestamp.
   - Before each request: compute `target = base + jitter()` (jitter is ±2s by default).
   - Sleep `Math.max(0, target - elapsed)` to enforce the gap.
   - Update `lastRequestAt = Date.now()`.

2. **Retry on 5xx** (`fetch.ts: attempt()`):
   - On network error or HTTP 5xx: retry up to 3 times with backoff.
   - Backoff sequence: 10s, 30s, 90s (configurable via `POLITENESS.retryBackoffsMs`).
   - Each retry waits the inter-request delay again.
   - Mark success on 200 (resets circuit counter).

3. **Circuit Trip on 4xx** (`fetch.ts: attempt()` + `circuit.ts`):
   - On 403/429: call `circuit.tripImmediately()` then throw `CircuitTrippingError` immediately on the FIRST occurrence — no retry, no threshold (`fetch.ts:196-200`).
   - On other 4xx (400/401/405/…, but NOT 404): call `circuit.recordFailure()` ONCE and **return the response without retrying** (`fetch.ts:217-219`). The "3 consecutive" threshold therefore accrues across separate requests/ticks, not across retries of one request. At the threshold the sentinel opens.
   - On 404: **not a failure at all** — falls through to the success path, calls `circuit.recordSuccess()` and returns the response (`fetch.ts:215-233`). 404 is treated as a normal delisting, NOT retried and NOT counted toward the threshold.
   - 2xx with a rejected content-type prefix (`text/html`, configured per-call via `rejectContentTypePrefix`) → `tripImmediately()` + throw `CircuitTrippingError` (`fetch.ts:225-231`).

4. **Headers & UA** (`fetch.ts: fetchGraphQL()`):
   - Every POST includes:
     - `User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0` (`POLITENESS.userAgent`)
     - `Accept-Language: ro-RO,ru-RU;q=0.9,en;q=0.8` (`POLITENESS.acceptLanguage`)
     - **Two distinct Accept values** in `POLITENESS`: `accept = 'text/html,application/xhtml+xml'` for HTML/index fetches, and `acceptJson = 'application/json, text/plain, */*'` for GraphQL POSTs. The GraphQL POST uses `acceptJson`.
     - `Origin: https://999.md` (`POLITENESS.origin`), `Referer: https://999.md/ro/list/real-estate/houses-and-yards` (`POLITENESS.referer`)
     - `Sec-Fetch-Dest: empty`, `Sec-Fetch-Mode: cors`, `Sec-Fetch-Site: same-origin`
   - No cookies sent (fresh bootstrap on each process start; manual capture-session seeds `.env.local` for one-time setup).
   - Note: `POLITENESS.referer` is the `houses-and-yards` listings URL (`src/config.ts:77`), whereas `verify-robots.ts` checks the `houses-and-villas` path and `capture-session.ts` navigates `house-and-garden` — these three slugs are not the same string and are intentionally independent (config referer is a static decoy header; the script URLs are the live 999.md routes).

### Docker Compose Deployment

1. **Services**:
   - `postgres:16-alpine` (NOT `postgres:16`; container `house-track-postgres`) on `127.0.0.1:5432`. `restart: unless-stopped`. Requires both `POSTGRES_PASSWORD` and `RO_PASSWORD` in `.env` — compose uses `${VAR:?...}` fail-closed syntax, so a missing value aborts `docker compose up` with the documented error.
   - `property-crawler` (Node app; container `property-crawler`) on `127.0.0.1:3000`; `depends_on: postgres condition: service_healthy`; `restart: unless-stopped`. `logging` driver `json-file` with `max-size: 10m`, `max-file: 5` (log rotation — omitted from the original spec).
   - Web UI served from same Node process.
   - **Read-only role**: created on first DB init by `scripts/init-ro-role.sh` (mounted at `/docker-entrypoint-initdb.d/10-init-ro-role.sh:ro`), which sources `scripts/create-ro-role.sql` (mounted at `/opt/house-track/create-ro-role.sql:ro`). The hook hard-fails if `RO_PASSWORD` is unset. For an already-initialised volume it does NOT re-run — run `create-ro-role.sql` by hand.
   - Volume `pg-data:/var/lib/postgresql/data` persists Postgres data. (Note: there is no compose-level named volume for the circuit sentinel `/data`; the crawler service mounts none — `/data` is in-container only unless the operator adds a bind mount.)

2. **Environment**:
   - `TZ=Europe/Chisinau` on both services so **Postgres** naive datetimes (the DB was switched from SQLite to Postgres — see operator-ui.md) and cron jobs align with operator's local time. Set in the Dockerfile runtime stage AND in compose.
   - `DATABASE_URL=postgresql://house_track:$POSTGRES_PASSWORD@postgres:5432/house_track` — injected by **compose only**, NOT baked into the Dockerfile.
   - `NODE_ENV=production` (Dockerfile runtime stage + compose).

3. **Image & Entrypoint** (`Dockerfile`):
   - Multi-stage: `deps` (pnpm via corepack, `pnpm install` + `pnpm prisma generate`) → `build` (`pnpm build`) → `runtime` (`node:22-bookworm-slim` + `tini` + `ca-certificates`). `ARG NODE_VERSION=22`, `ARG PNPM_VERSION=9.12.0`.
   - Runs as non-root `USER node`; files copied `--chown=node:node`.
   - `ENTRYPOINT ["/usr/bin/tini", "--"]` (tini as PID 1 for signal handling/zombie reaping).
   - `CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/index.js"]`. Prisma is invoked directly from `node_modules/.bin` (NOT via pnpm) to avoid re-triggering corepack at runtime. `migrate deploy` is idempotent (no-op when DB is current); if it exits non-zero, the `&&` short-circuits and the app never boots.

4. **Health Checks**:
   - Postgres: `pg_isready -U house_track -d house_track` every 5s (timeout 3s, retry 10×).
   - Crawler: depends on postgres being healthy before starting.

### Capture-Session Workflow (Manual)

Triggered when fixtures get stale or schema drifts (every few months or after 999.md UI changes):

1. **Prep** (docs/capture-session.md §0):
   - Use Firefox (matching our UA claim) in a fresh private window.
   - Open DevTools → Network tab → set to XHR/Fetch only.

2. **Bootstrap Session** (§1):
   - Navigate to `https://999.md/` (homepage).
   - Click Imobiliare → Case, vile.
   - Click Chișinău.
   - Wait for grid + scroll once (~30 seconds).
   - Capture cookies from DevTools → Application tab.
   - Save to `.env.local` as `BOOTSTRAP_COOKIES="cf_clearance=...; ..."` (gitignored).

3. **Capture SearchAds** (§2):
   - Find POST to `https://999.md/graphql` with `operationName: SearchAds`.
   - Right-click → Copy as cURL.
   - Extract `query` string → update `src/graphql.ts` `SEARCH_ADS_QUERY` body.
   - Extract `variables` shape → compare against `buildSearchVariables(0)` in `src/graphql.ts`; update if shape differs.
   - Compare `variables.searchInput.filters` IDs with `FILTER.searchInput` in `src/config.ts`; note drift.
   - Identify any new headers (Origin, Referer, Sec-Fetch-\*); add to `src/config.ts` `POLITENESS.extraHeaders` if needed.
   - Verify `User-Agent` matches `POLITENESS.userAgent`; update if drifted.

4. **Capture GetAdvert** (§3):
   - Click a listing; find POST with `operationName: GetAdvert`.
   - Extract `query` → update `src/graphql.ts` `GET_ADVERT_QUERY`.
   - Extract `variables` → compare against `buildAdvertVariables(id)`; update if wrapped differently.

5. **Refresh Fixtures** (§4):
   - Copy SearchAds response → `src/__tests__/fixtures/search-ads-response.json` (trim to 5 ads).
   - Copy GetAdvert response → `src/__tests__/fixtures/advert-detail-response.json`.
   - Run `pnpm test` — any parser test failure reveals real schema drift needing code updates.

6. **Automated Artifact Writes** (`scripts/capture-session.ts`):
   - Reads Firefox interception and writes:
     - `src/graphql.ts` (query bodies: `SEARCH_ADS_QUERY`, `GET_ADVERT_QUERY`, and `FILTER_TAXONOMY_QUERY` if taxonomy captured)
     - `src/__tests__/fixtures/search-ads-response.json` (5-ad trim)
     - `src/__tests__/fixtures/advert-detail-response.json` (full detail)
     - `src/data/filter-taxonomy.1406.json` (taxonomy body — only if taxonomy captured; lives under `src/data/` so it ships in the production build)
     - `docs/captured-headers.md` (header capture log — union of SearchAds + GetAdvert request headers)
     - `.env.local` (cookies, via `formatCookieEnv`)
   - **Hard-required**: SearchAds AND GetAdvert. If either is missed → `process.exit(1)` with NO writes ("✗ Capture incomplete — aborting without writing files").
   - **Taxonomy is best-effort**: if SearchAds+GetAdvert succeed but taxonomy is not auto-detected, the script writes all other artefacts, prints a "⚠ Taxonomy not auto-captured … re-run with `--taxonomy-op=<Name>`" warning, and **returns normally (exit 0)** — it is NOT rolled back. Taxonomy op is detected via `looksLikeTaxonomyOpName(op)` heuristic or the `--taxonomy-op=<Name>` override.
   - **GetAdvert fallback**: 999.md SSRs detail pages, so GetAdvert is usually NOT fired client-side. After a 5s wait the script falls back to `probeGetAdvert()` — a direct GraphQL POST with the existing `GET_ADVERT_QUERY`. If the query is rejected by schema (`kind:'errors'`), it runs `buildAdvertQueryViaIntrospection()` against the `Advert` `__type`, selecting scalar/enum fields, wrapping OBJECT/INTERFACE/UNION fields as `{ __typename }`, and **skipping any field with a NON_NULL (required) argument**; `id` is force-prepended.
   - Validates typechecking (`pnpm typecheck`) AFTER writing `src/graphql.ts`; on non-zero status it restores from `src/graphql.ts.bak` and throws. Then runs `pnpm prettier --write src/graphql.ts`.
   - Browser launch sets `userAgent: POLITENESS.userAgent`, `viewport 1280×900`, `locale: 'ro-RO'`. Headed by default; `--headless` flag and `--timeout <ms>` supported.

7. **Smoke Test** (§7):
   - Run `pnpm test` (parsers/fetcher green).
   - Run `RUN_ONCE=1 LOG_LEVEL=debug pnpm dev` (one live tick against 999.md).
   - Verify first request returns 200, SearchAds returns `data.searchAds.ads`, no 4xx, DB row count grows.

## Contracts & Types

### Key Input/Output Types

**From `types.ts`:**

- `ListingStub`: `{ id, url, title, priceEur?, postedAt? }` — parsed from index page.
- `ParsedDetail`: Full listing schema with `id, title, priceEur, priceRaw, rooms, areaSqm, landAre, district, sector, street, floors, yearBuilt, heatingType, description, features[], imageUrls[], sellerType, postedAt, bumpedAt, lat, lon, authorId, authorName, authorType, phone, canonicalId`.
- `ListingFilterValue`: `{ listingId, filterId, featureId, optionId?, textValue?, numericValue? }` — one row per filter triple on a listing.
- `SweepRun`: Metadata row tracking start time, duration, status, page/detail counts, error array, config snapshot, event log.
- `Setting`: `{ key, valueJson }` — runtime-mutable crawler tuning; keys like `politeness.baseDelayMs`, `sweep.maxPagesPerSweep`.

**Fetcher callbacks** (`sweep.ts: SweepDeps`):

- `fetchSearchPage(pageIdx: number, signal?: AbortSignal) => Promise<FetchEnvelope>` — returns `{ json: unknown, bytes: number, attempts: number }`.
- `fetchAdvert(id: string, signal?: AbortSignal) => Promise<FetchEnvelope>` — same envelope.

**Persistence envelope** (`persist.ts`):

- `diffAgainstDb(stubs)` → `{ new: ListingStub[], seen: ListingStub[] }` (no `gone` key; age-out is the separate `markInactiveOlderThan(ageMs)`).
- `persistDetail(parsed: ParsedDetail)` → void; upserts Listing, inserts ListingSnapshot if hash changed.
- `finishSweep(sweepId, result: SweepResult)` → void; writes `SweepRun` row with final status + counts.

**Circuit interface** (`circuit.ts`):

- `isOpen()` → boolean (checks sentinel mtime vs pause duration).
- `recordFailure()` → void (increments counter; opens sentinel on threshold).
- `recordSuccess()` → void (resets counter to 0).
- `tripImmediately()` → void (opens sentinel on 403/429).

### Error Shapes

- `CircuitTrippingError`: thrown by fetcher on 403/429; caught by sweep, records to `SweepRun.errors` + increments circuit counter.
- `AdvertNotFoundError`: thrown by `parseDetail()` on missing/invalid listing detail; caught by sweep, logs, skips that listing.
- Generic `Error`: network failures, parse failures on individual listings; logged to `SweepRun.errors` array (JSON); sweep continues.

### Settings Namespace (Read via `getSetting(key, defaultValue)`)

Defaults are sourced from `src/config.ts` via `src/settings.ts` (`DEFAULTS` map, validated by the per-key zod `SCHEMAS` map). Verified against `src/config.ts` / `src/settings.ts`:

- `politeness.baseDelayMs` — inter-request wait (default 8000).
- `politeness.jitterMs` — ±jitter around base (default 2000).
- `politeness.detailDelayMs` — per-detail override (default 10000).
- `politeness.softThrottleMultiplier` — adaptive-throttle multiplier (default 3; **plumbed, not yet wired** — see Open Questions).
- `politeness.softThrottleDurationMinutes` — soft-throttle window (default 30; plumbed, not yet wired).
- `sweep.maxPagesPerSweep` — pagination cap (default **50**, sourced from `FILTER.maxPagesPerSweep`, not `SWEEP`).
- `sweep.backfillPerSweep` — unenriched listings to process per tick (default **30**).
- `sweep.staleRefreshPerSweep` — oldest lastFetchedAt entries to refresh per tick (default **50**).
- `sweep.targetListingsPerSweep` — stop paginating when accumulated count exceeds the per-tick draw (default **700**).
- `sweep.targetListingsJitter` — ±jitter on target (default **130**).
- `sweep.expectedPerDay` — sweeps per 24h, used as a stable anchor for the missing-listings inactive threshold; **decoupled from the cron expression** (default **2**, NOT 24).
- `sweep.cronSchedule` — cron expression (default `0 9,21 * * *`, `DEFAULT_SCHEDULE` in `src/index.ts:29`); **requires restart to apply**.
- `sweep.cronWindowJitterMs` — offset before executing scheduled cron (default **3600000 = 1h**, NOT 5000; `setTimeout(random(0,N))` after the cron fires).
- `sweep.quietHoursStart` / `sweep.quietHoursEnd` — hour range [start, end) to suppress cron (default **2 / 6**, i.e. quiet hours ARE on by default; zod constrains both to int 0–23). Set start == end to disable.
- `sweep.mode` — `'legacy'` | `'two_tier'` (default `'legacy'`; two-tier scheduler is PR-2 plumbing, not wired).
- `sweep.indexTick*` / `sweep.detailTrickle*` / `sweep.staleThresholdHours` / `sweep.watchlistRefreshHours` — two-tier cadence plumbing (defaults in `SWEEP`); no code reads these yet.
- `circuit.consecutiveFailureThreshold` — failures before open (default 3).
- `circuit.pauseDurationMs` — pause length (default 86400000 = 24h).
- `filter.generic` — **structured filter object** (`genericFilterSchema`), default `defaultGenericFilter` from `src/types/filter.ts`. This is the live search filter (region/locality/price/area/category), NOT `filter.maxPriceEur`/`filter.maxAreaSqm` (those keys do **not** exist as Setting rows). The price cap is applied source-side in the GraphQL filter (see Invariant 8).
- `log.level` — pino level (default `info`; zod union of allowed levels).

## Invariants & Business Rules

1. **8s±2s politeness is non-negotiable.** Every inter-request gap must be enforced via `maybeWaitBetweenRequests()`. Violating this risks IP bans or serving as a bot signal.

2. **One sweep at a time.** The guard `findInProgressSweep()` ensures no concurrent ticks. Phantom rows from crashed processes are not auto-cleaned; operator must manually cancel via API or delete the row.

3. **Circuit breaker is manual-clear.** Three consecutive 4xx (excl. 404) opens the sentinel file; it stays open for 24h by mtime. No auto-recovery. Manual clear: delete the sentinel (default `/data/.circuit_open` — absolute, `CIRCUIT.sentinelPath`) or click "Reset" in Sweeps page UI.

4. **Settings are read once per sweep start.** Changes via the operator UI take effect on the _next_ scheduled cron tick or manual trigger. Cron _schedule_ changes require a process restart.

5. **Cookies are disposable.** No persistent cookie jar. Bootstrap is one-time (manual capture-session writes to `.env.local`). In-band cookie refresh (a future feature) would re-bootstrap on anti-bot expiry.

6. **TZ=Europe/Chisinau must be set.** All naive datetimes in Postgres (now(), cron ticks) are computed in that TZ. Mismatch breaks staleness calculations and quiet hours logic.

7. **Detail fetches are 10s spaced, not 8s.** Index pages use the base delay; detail fetches override with `detailDelayMs=10s`. This is intentional: showing slower browsing on detail pages mimics realistic human pacing.

8. **Price filtering is at SOURCE; area filtering is at parse time.** `FILTER.searchInput.filters` DOES include a price cap (`filterId 9441`, `featureId 2`, `UNIT_EUR`, `range.max='250000'` — `src/config.ts:53`), so over-budget listings are excluded server-side. The **area** filter key is still unknown (`src/config.ts:23-28` "STILL UNKNOWN"), so over-large listings are still dropped at parse time in `parse-index.ts`. (The older spec claim that price is dropped at parse time is incorrect — only area is.) Note `FILTER.searchInput.filters` uses `filterId` values 16/32/9441 (not 41/40), and `subCategoryId 1406`.

9. **robots.txt is a courtesy check, not a hard gate.** We run `verify-robots` before each manual capture-session to confirm `/graphql` is allowed. A fail is a warning, not a blocker, but hitting a disallowed path would be a governance violation.

10. **Filter taxonomy is bootstrapped but can be captured live.** The `FilterValue` table uses `filterId=0` (unknown) until we capture a taxonomy response and run `backfill-filter-ids`. Bootstrap LUT in `src/config.ts` seeds common featureIds; live taxonomy extends it.

## Edge Cases & Failure Modes

### Network Failures

- **5xx (500, 502, 503, etc.)**: Retry with backoff (10s, 30s, 90s). Each retry observes the inter-request delay again. If all 3 attempts fail, log to `SweepRun.errors` and continue.
- **Connection reset / timeout**: Treated as a network error; retries apply.
- **404 on a listing**: Not a failure. `attempt()` returns the 404 response on the SUCCESS path and calls `recordSuccess()` (resetting the consecutive-4xx counter). Not retried, not circuit-tripping. The caller treats the missing listing as delisted.
- **Non-404 4xx (400/401/405/…)**: `recordFailure()` is called exactly ONCE per occurrence and the response is returned (no retry). Three such occurrences across requests open the breaker.

### Anti-Bot Signals

- **403 Forbidden / 429 Too Many Requests**: Trips circuit immediately via `tripImmediately()`; throws `CircuitTrippingError`. Sweep catches, records to errors, closes with `status='partial'`. Next tick skips due to open circuit.
- **HTML interstitial (CAPTCHA / Cloudflare challenge)**: `fetchGraphQL()` checks `content-type` and rejects `text/html` responses, throwing immediately. Caught by sweep, logged, and treated as a circuit-tripping condition.

### Parse Failures

- **Single listing parse error** (malformed response, missing field): Log with sample HTML, skip that listing, continue sweep.
- **Schema drift on all listings** (e.g., field name change): Every detail parse fails; `SweepRun.status='partial'`, `errors` array populated. Manual inspection via `docs/capture-session.md` required.

### Stale / Phantom Sweeps

- **Phantom in_progress row** (from crashed prior tick): `findInProgressSweep()` returns non-null; new tick skips. Operator must manually cancel via `/api/sweeps/:id/cancel` or delete the DB row.
- **Crashed process during detail fetch**: Partial `ListingFilterValue` rows may be inserted for that listing. Next sweep's backfill picks it up and completes enrichment.

### Deployment Failures

- **Postgres down**: Crawler cannot start (health check blocks). Operator must restart postgres or fix connectivity.
- **Migration failure**: Boot fails; Dockerfile logs the failure. Operator must inspect migration history and database state, possibly rolling back or applying pending migrations manually.
- **Circuit sentinel deleted during pause window**: Next tick proceeds as if breaker is closed (risk of immediate re-trip if the underlying issue persists). Operator is responsible for confirming the issue is resolved before deleting.

### TZ Mismatches

- **TZ not set or set to UTC**: Quiet hours logic and staleness calculations misfire. E.g., a 22:00 cron tick in Chisinau looks like 20:00 UTC, triggering quiet hours when it shouldn't.

## Configuration & Operational Notes

### Environment Variables

- `DATABASE_URL`: Postgres connection string (required for `docker compose`).
- `POSTGRES_PASSWORD`: Set in `.env` (required; compose will fail without it).
- `RO_PASSWORD`: Set in `.env` (required; used by the read-only role for MCP queries).
- `NODE_ENV=production` (hardcoded in Dockerfile).
- `TZ=Europe/Chisinau` (hardcoded in Dockerfile and compose).

### Sentinel Files

- `/data/.circuit_open` (absolute path; `CIRCUIT.sentinelPath`): Empty file created when circuit trips; mtime checked on next tick to see if pause duration has elapsed. In the container the `/data` mount holds it; on a host dev run it resolves to the absolute `/data` directory, so terminal commands in docs that use a relative `data/.circuit_open` only match when CWD-relative — prefer the configured absolute path.

### Fixtures & Artifacts

- `src/graphql.ts`: GraphQL query bodies; updated by `capture-session.ts`.
- `src/__tests__/fixtures/search-ads-response.json`: 5-ad fixture used by parser tests.
- `src/__tests__/fixtures/advert-detail-response.json`: Single-listing detail fixture.
- `src/data/filter-taxonomy.1406.json`: Live taxonomy capture for the houses subcategory (1406); merged into bootstrap LUT by `backfill-filter-ids.ts`. A sibling `src/data/filter-taxonomy.1404.json` (apartments, 1404) also exists. `backfill-filter-ids.ts` reads only the `.1406.json` path (`TAXONOMY_FIXTURE`, script line 29); its own header comment referencing a generic `filter-taxonomy.json` is stale.
- `.env.local`: Gitignored; holds bootstrap cookies (one-time, manual setup).
- `docs/captured-headers.md`: Generated by `capture-session.ts`; logs observed request headers.

### Operational Gotchas

1. **Param IDs in 999.md URLs are opaque.** `o_30_237=775` shifts across category trees. Never guess; always copy from a real browser session (capture-session does this).

2. **Price normalization:** ~90% EUR, but watch for MDL/USD listings. Store `priceRaw` always for audit; normalize separately to EUR.

3. **Cookies expire.** Anti-bot cookies (`cf_clearance`, `__cf_bm`) last ~30 minutes. Bootstrap from a fresh session whenever capturing; stale cookies → 403/429 → circuit trip.

4. **robots.txt compliance.** The crawler only POSTs to `/graphql` and fetches listing index pages. Reference URLs (`/ro/<id>`) are never fetched (operators click them manually). Verify with `pnpm verify-robots` before each capture-session.

5. **Filter ID drift.** When 999.md reorders categories or adds filters, the `featureId` → `filterId` mapping changes. Bootstrap LUT in `src/config.ts` seeds common values; live captures extend it. Rows with `filterId=0` are unknown and backfilled on next capture.

6. **Quiet hours cross midnight.** If `quietHoursStart=22` and `quietHoursEnd=6`, the range wraps: the check is `hour >= 22 OR hour < 6`. If start < end (e.g., 9–17), it's a simple range check.

## Acceptance Criteria

1. ✅ Docker Compose deployment boots Postgres + crawler on `127.0.0.1` (no public exposure).
2. ✅ Migrations run automatically on boot; database is ready before crawler ticks.
3. ✅ Cron schedule is read from `Setting` table; default is `0 9,21 * * *` (9 AM and 9 PM Europe/Chisinau).
4. ✅ Inter-request delay is enforced: 8s ± 2s jitter, measured by tracking `lastRequestAt` per `Fetcher` instance (concurrency 1).
5. ✅ Politeness headers (User-Agent, Accept-Language, Origin, Referer, Sec-Fetch-\*) are sent on all POSTs; no cookies.
6. ✅ Circuit breaker opens after 3 consecutive 4xx (excl. 404); opens immediately on 403/429; state persists in `data/.circuit_open` sentinel file.
7. ✅ Pause duration is 24 hours (86400000 ms); checked via sentinel mtime on next tick.
8. ✅ Pause is manual-clear: operator deletes sentinel or clicks "Reset circuit breaker" button in Sweeps page UI.
9. ✅ Quiet hours logic works: read `sweep.quietHoursStart/End` from `Setting`, compute current hour in Europe/Chisinau, skip tick if in range.
10. ✅ Sweep is single-active: `findInProgressSweep()` returns non-null if any `SweepRun.status='in_progress'`; new tick skips and logs reason.
11. ✅ `capture-session.ts` launches Firefox, intercepts GraphQL POSTs, writes query bodies + fixtures + headers to disk, validates typechecking.
12. ✅ `verify-robots.ts` fetches `robots.txt` and confirms required paths are allowed for `User-agent: *`.
13. ✅ `backfill-filter-ids.ts` updates `filterId=0` rows using captured taxonomy + bootstrap LUT; idempotent (re-running is a no-op).
14. ✅ Operator UI `/api/settings` returns all runtime-mutable keys with current values and defaults; Settings page allows editing + persisting.
15. ✅ Operator UI Sweeps page shows circuit breaker tile, status badge per sweep, error log expansion, "Reset circuit" button, "Run smoke" button (manual 1-page sweep).
16. ✅ Dashboard shows last sweep tile, circuit breaker state, in-app analytics (active listings, new today, avg price, sweep success rate, by-district).
17. ✅ TZ=Europe/Chisinau is set in Dockerfile + compose so naive datetimes align with operator's cron expectations.
18. ✅ All logs are JSON (pino) to stdout; `docker compose logs -f crawler` shows structured events.
19. ✅ Error handling is graceful: unhandled exceptions in `tick()` log but do not kill the process; cron remains active.
20. ✅ Detail fetch delay is distinct from index delay: `detailDelayMs=10s` (sent to `Fetcher.fetchGraphQL()`) vs `baseDelayMs=8s` (default for index pages).

## Open Questions / Known Gaps

1. **Cookie auto-refresh.** Currently, bootstrap cookies are one-time (manual capture-session). A future feature should detect cookie expiry (403/429 rate spike) and trigger automatic re-bootstrap by fetching `/` + extracting `set-cookie` headers. This is plumbed but not implemented.

2. **Adaptive soft-throttle observer.** Config keys exist (`POLITENESS.softThrottleMultiplier`, `softThrottleDurationMinutes`) and the `ThrottleEvent` table is defined, but the rolling-window stats collector and trigger logic are not yet wired. PR 2 (mentioned in `poc-spec.md`) will land this.

3. **Pluggable source adapters.** UI shows a "Sources" page and "Add source" button, but only `999md` is implemented. The adapter interface is not finalized. Future sources (makler.md, lara.md) will be added as per Phase 5 in the backlog.

4. **Phone number reveal.** The `Listing.phone` field is defined but not populated — the 999.md GraphQL response currently doesn't include it. Requires a separate operation to click "Reveal contact" on each detail page.

5. **Geo dedup.** The `Listing.lat`, `Listing.lon` fields are defined for proximity-based dedup (P2 backlog) but not yet populated by the detail parser.

6. **Seller portfolio graph.** `Listing.authorId`, `Listing.authorName`, `Listing.authorType` are defined but the GetAdvert query doesn't yet fetch the owner object. A future extension will enable seller-portfolio aggregation.

7. **Canonical dedup cluster.** The `Listing.canonicalId` field is defined for image/geo/address-based dedup (P2 backlog) but the `recomputeClusters()` function doesn't exist yet.

8. **Taxonomy auto-discovery.** The `verify-robots.ts` script only checks a hardcoded set of paths; a future version should crawl the taxonomy hierarchically to auto-discover all allowed categories + subcategories without hardcoding feature IDs.

9. **Cron schedule hot-reload.** Changes to `sweep.cronSchedule` via the operator UI require a process restart. A future version should support re-scheduling without downtime.

10. **Auth/TLS.** The operator UI is localhost-only with no authentication or HTTPS. Adding multi-user auth + TLS is deferred to Phase 4+ (mobile, external deployment).

---

**Last reviewed:** 2026-05-24
**Status:** Production-ready (POC milestone achieved; Phase 2+ deferred)

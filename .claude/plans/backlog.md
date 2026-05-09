# house-track — Backlog

## Priority 1 — Backfill quality (data correctness blockers, tracked 2026-05-01)

POC live smoke is meaningless until both GraphQL captures are refreshed —
without them, sweeps populate sparse `ListingFilterValue` rows and `list_filters`
returns no labels.

- [ ] **Re-capture `GetAdvert` with the full feature selection set.** The
      currently-captured query in `src/graphql.ts:274` (timestamp
      `2026-05-01T15:16:14.864Z`) only requests `id, state, title, posted,
      reseted, expire, isExpired, owner, autoRepublish, moderation, package,
      subCategory`. It does NOT request `price`, `body`, `region`, `city`,
      `street`, `mapPoint`, `images`, `offerType`, or any `feature(id: N)`
      lookups — but `parseDetail` and the fixture both expect them. Without
      a richer query, live sweeps will populate sparse `ListingFilterValue`
      rows. Use `pnpm capture-session` (or DevTools Network panel on
      999.md/ro/<some-listing>) to grab a real `GetAdvert` request whose
      selection set matches the fixture, paste the `query` string into
      `src/graphql.ts`, and refresh `src/__tests__/fixtures/advert-detail-response.json`
      from the same response.
- [ ] **Capture 999.md's filter taxonomy GraphQL operation** (the one that
      returns `(filterId → featureId → optionId, label)` mappings). Until
      this lands, `src/persist.ts` stores `filterId = 0` and `list_filters`
      returns observed groups without authoritative labels. Same workflow:
      open the listings page, find the GraphQL request that powers the
      sidebar filter UI, capture its query + variables.
- [ ] **Wire Claude Desktop**: `pnpm build` → edit
      `claude_desktop_config.json` per `docs/mcp-setup.md` → restart Desktop
      → verify all three MCP tools (list_filters, search_listings,
      get_listing) appear and respond.
- [ ] **First live smoke**: `RUN_ONCE=1 pnpm dev` against real 999.md.
      Confirm in `pnpm prisma studio`: ListingFilterValue rows for new
      listings, filterValuesEnrichedAt populated, ~30 backfill rows per
      tick, no 403/429.

## Priority 1.6 — UI polish from finalization audit (tracked 2026-05-09)

Discovered while auditing the redesign for finalization. Small, but the
redesign is not honest until they ship.

_All Priority 1.6 items shipped — see Done section._

## Priority 2 — Acceptance criteria validation

Gate after first live smoke passes; runs over the following 7 days.

- [ ] 7 consecutive days of hourly sweeps, ≥ 95% `status=ok`.
- [ ] ≥ 200 unique listings captured.
- [ ] Spot-check 10 random listings: parsed fields match the live page.
- [ ] Zero 403/429 across the week.
- [ ] At least one observed price change captured as a snapshot.

## Priority 3 — Later (post-POC backlog from spec §"High-level backlog")

- [ ] Phase 2: LLM scoring with Haiku 4.5 + prompt-cached rubric.
- [ ] Phase 3: Telegram bot delivery.
- [ ] Phase 4: React/Vite/Tailwind PWA on Cloudflare Pages.
- [ ] Phase 5: makler.md + lara.md sources, cross-source dedup.
- [ ] Phase 6: Capacitor wrap + Web Push.
- [ ] Phase 7: Telegram channel ingestion, vision LLM, sold-price calibration.

---

## Done

### POC crawler core

- [x] `src/circuit.ts` — sentinel `data/.circuit_open`, threshold + 24h cooldown (8 tests).
- [x] `src/fetch.ts` — undici client, 8s±2s jitter, retries, 403/429 → CircuitTrippingError, politeness profile (25 tests).
- [x] `src/persist.ts` — Prisma upsert + snapshot on hash change, sweep bookkeeping, atomic `ListingFilterValue` write, `findUnenrichedListings` (16 tests).
- [x] `src/sweep.ts` — orchestrator + trickle-backfill via `SWEEP.backfillPerSweep` (14 tests).
- [x] `src/index.ts` — node-cron hourly entrypoint wired to real deps.
- [x] `src/log.ts` smoke test (2 tests).
- [x] Real 999.md filter param IDs in `src/config.ts` (verified GraphQL filter IDs 2026-04-26).
- [x] Index + advert detail fixtures in `src/__tests__/fixtures/`.
- [x] `src/parse-index.ts` — GraphQL JSON parser (13 tests).
- [x] `src/parse-detail.ts` — JSON parser + `extractFilterValues` over `FEATURE_*` entries (19 tests).
- [x] Schema enrichment — `ListingFilterValue` table with facet indexes, `Listing.filterValuesEnrichedAt`.
- [x] `src/mcp/server.ts` — local stdio MCP with `list_filters`, `search_listings`, `get_listing` (18 tests).
- [x] First Prisma migrations (`init`, `add_listing_filter_value`).
- [x] **Verify `999.md/robots.txt`** — `pnpm verify-robots` (live + 9 unit tests). `User-agent: *` does not disallow `/graphql`, `/ro/list/...`, or `/ro/<id>` (verified 2026-05-02).
- [x] **Local Docker compose smoke test** — `POSTGRES_PASSWORD=changeme docker compose up -d --build`. Surfaced and fixed three real bugs: (1) Dockerfile runtime stage missing `--chown=node:node` on COPY (caused Prisma engine write failures under `USER node`); (2) Slice 2 added `Setting`/`Source` to schema but never created a migration — now in `20260502192036_add_setting_source`; (3) Prisma client only generated for `linux-arm64-openssl-1.1.x`, but Bookworm-slim ships OpenSSL 3.0 — added `linux-arm64-openssl-3.0.x` and `debian-openssl-3.0.x` to `binaryTargets`. Post-fix: 6 app tables present, 2 migrations applied, crawler boots cron, Grafana `/api/health` 200.

### Operator UI + Postgres + Grafana

Parent plan: [`operator-ui-postgres-grafana.md`](./operator-ui-postgres-grafana.md). All 7 slices shipped.

- [x] **Slice 1** — Postgres migration + per-process testcontainers, 147/147 green ([PR #6](https://github.com/SleepyDreamsDev/house-track/pull/6)). Plan: [`postgres-migration.md`](./postgres-migration.md).
- [x] **Slice 2** — `Setting` + `Source` tables, `src/settings.ts`, runtime override wiring in `sweep`/`fetch`/`circuit`.
- [x] **Slice 3** — Hono API layer + `web` service (sweeps/listings/filters/settings/sources/circuit) reusing `src/mcp/queries.ts`.
- [x] **Slice 4** — Vite SPA scaffold: react-router + TanStack Query/Table + shadcn primitives, 4 pages.
- [x] **Slice 5** — `frontend-design` visual pass over the 4 pages.
- [x] **Slice 6** — Grafana provisioning + Dashboard-page iframe.
- [x] **Slice 7** — Docs: `docs/operator-ui.md`, poc-spec append, CLAUDE.md Stack/Quick-Start update.

### UI redesign port-kit Phases 1–4

Parent plan: [`ui-redesign-port-kit.md`](./ui-redesign-port-kit.md). All phases shipped via `/run-backlog` between 2026-05-03 and 2026-05-09.

- [x] **Phase 1 — co-locate crawler + web API in one Node process** ([PR #17](https://github.com/SleepyDreamsDev/house-track/pull/17), `b73fbc2`). `src/index.ts` boots cron + `serve()` together; `docker-compose.yml` exposes `127.0.0.1:3000:3000`.
- [x] **Phase 2 Task 1 — persist sweep detail JSON columns** ([PR #19](https://github.com/SleepyDreamsDev/house-track/pull/19), `c890426`). `runSweep`/`finishSweep` populate `pagesDetail`, `detailsDetail`, `configSnapshot`, `eventLog` on `SweepRun`; `sweeps.detail.ts` reads them with `parseInt(:id)`.
- [x] **Phase 2 Task 4 — settings metadata** ([PR #20](https://github.com/SleepyDreamsDev/house-track/pull/20), `c0ec340`). `src/settings.ts:44-124` ships `{group, kind, unit?, options?, label?, hint?}` per row, projected by `GET /api/settings`.
- [x] **Phase 3 Task 2 — pino → EventEmitter tee for SSE** ([PR #21](https://github.com/SleepyDreamsDev/house-track/pull/21), `9dd9bed`). `src/log.ts:7-55` Writable tees JSON lines to `sweepEvents`; `getActiveSweepId()` exported from `src/sweep.ts`; SSE route coerces id via `String(...)`.
- [x] **Phase 3 Task 3 — real Prisma queries** for `/api/stats/by-district`, `/api/stats/new-per-day`, `/api/listings/new-today`, `/api/listings/price-drops` ([PR #22](https://github.com/SleepyDreamsDev/house-track/pull/22), `de8e988`). Price-drop detection uses `ListingSnapshot` ≥5% over 7d.
- [x] **Task 5 — `/api/listings` envelope + sort/q/flags** ([PR #23](https://github.com/SleepyDreamsDev/house-track/pull/23), `125c3f1`). `searchListings` in `src/mcp/queries.ts:136-225` accepts `sort=newest|price|eurm2`, `q`, `flags=priceDrop`; returns `{listings,total}`.
- [x] **Sweep API gaps** ([PR #24](https://github.com/SleepyDreamsDev/house-track/pull/24), `aaea7c1`). `POST /api/sweeps`, `POST /api/sweeps/:id/cancel` with `AbortController`, `source`/`trigger` columns on `SweepRun`, `durationMs` projection, structured `progress` shape.
- [x] **Task 6 — contract + BDD tests** for every new route and SSE ([PR #25](https://github.com/SleepyDreamsDev/house-track/pull/25), `2eaeb77`). 22+ test cases across `sweeps-api-*`, `listings.feed`, `stats`, `sweeps.stream`.
- [x] **Correctness fixes across sweep, log, persist, and routes** (`cd3af85`).
- [x] **`CLAUDE_CODE_E2E.md` cleanup** ([PR #27](https://github.com/SleepyDreamsDev/house-track/pull/27), `ea85a29`). Brief deleted; relevant content folded into `docs/operator-ui.md`.

### UI polish from finalization audit (Priority 1.6)

Shipped 2026-05-09 via single bundled PR (4 small items).

- [x] **Dashboard KPI strip — `successRate` + `avgPrice` from real endpoints.** `GET /api/stats/success-rate` returns `{rate, ok, total, window}` over last N finished sweeps (N from `stats.successRateWindow` setting, default 100). `GET /api/stats/avg-price` returns mean `priceEur` over active listings. Both wired into `web/src/pages/Dashboard.tsx`.
- [x] **Listings header — Refresh wired, Export CSV removed.** `web/src/pages/Listings.tsx` Refresh now invalidates the `['listings']` query; Export CSV button removed.
- [x] **`SweepDetail.currentlyFetching` populated.** `src/sweep.ts` exports `setCurrentlyFetching` / `getCurrentlyFetching`; the setter fires before each `fetchAdvert` in both new-stubs and seen-stubs loops, cleared at end of `fetchAndPersistDetails` + in `runSweep` finally. `src/web/routes/sweeps.detail.ts` returns the in-memory state only when `getActiveSweepId()` matches the requested sweep id (returns `null` for stale `in_progress` rows after a process restart).
- [x] **Stale stub comments removed** from `src/web/routes/sweeps.detail.ts:1-7`.

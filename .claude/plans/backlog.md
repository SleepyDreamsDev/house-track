# house-track — Backlog

## Priority 1 — POC crawler completion

_All items done — see Done section._

## Priority 2.5 — UI redesign follow-ups (port-kit Phase 1+, tracked 2026-05-03)

Parent plan: [`ui-redesign-port-kit.md`](./ui-redesign-port-kit.md). Phase 0
(kit install + stub routes + frontend test rewrite) shipped — pages render
end-to-end, all backend routes 200. Phases 1–4 are tracked here.

- [x] **Phase 1 — co-locate crawler + web API in one Node process.** Required
      for the kit's in-process SSE EventEmitter to work; today they're
      separate processes. `src/index.ts` boots cron only; web API needs to
      `serve()` alongside. Add a `127.0.0.1:3000:3000` port mapping to the
      `property-crawler` service in `docker-compose.yml`.
      Plan: [`ui-redesign-port-kit.md`](./ui-redesign-port-kit.md). _Shipped in PR #17._
- [ ] **Phase 2 Task 1 — persist sweep detail JSON columns.** Capture
      pages/details rows + config snapshot in `runSweep`/`finishSweep` (see
      `src/sweep.ts:42`, `src/persist.ts:150`). Then uncomment the REAL IMPL
      in `src/web/routes/sweeps.detail.ts` and `parseInt` the `:id` param
      (SweepRun.id is `Int`, not string).
      Plan: [`ui-redesign-port-kit.md`](./ui-redesign-port-kit.md). _Run via `/feature`._
- [ ] **Phase 2 Task 4 — settings metadata.** Extend `src/settings.ts` with
      `{group, kind, unit?, options?, label?, hint?}` per row, and project
      those fields in `GET /api/settings`.
      Plan: [`ui-redesign-port-kit.md`](./ui-redesign-port-kit.md). _Run via `/feature`._
- [ ] **Phase 3 Task 2 — pino → EventEmitter tee for SSE.** Custom write
      stream in `src/log.ts` emits to `sweepEvents` keyed by an
      `activeSweepId` module variable from `src/sweep.ts`. Coerce the id
      comparison in `src/web/routes/sweeps.stream.ts` to `String(...)`.
      Plan: [`ui-redesign-port-kit.md`](./ui-redesign-port-kit.md). _Run via `/feature`._
- [ ] **Phase 3 Task 3 — real Prisma queries** for `/api/stats/by-district`,
      `/api/stats/new-per-day`, `/api/listings/new-today`, and
      `/api/listings/price-drops`. Use `ListingSnapshot` for price-drop
      detection (≥5% over 7d).
      Plan: [`ui-redesign-port-kit.md`](./ui-redesign-port-kit.md). _Run via `/feature`._
- [ ] **Task 5 — `/api/listings` envelope + sort/q/flags.** Currently
      returns a bare array; both old and new UI consume `{listings,total}`.
      Wrap with `prisma.listing.count`, wire `sort=newest|price|eurm2`,
      `q` (title ILIKE), `flags=priceDrop`. Update `searchListings` in
      `src/mcp/queries.ts` to accept the new params.
      Plan: [`ui-redesign-port-kit.md`](./ui-redesign-port-kit.md). _Run via `/feature`._
- [ ] **Sweep API gaps (manual trigger, cancel, source/trigger cols, durationMs, progress shape).**
      Wires up: (a) `POST /api/sweeps` thin wrapper around `runSweep(deps)`
      for the Dashboard "Run sweep now" button; (b) `POST /api/sweeps/:id/cancel`
      with `AbortController` plumbed through `Fetcher` + `runSweep`; (c)
      adds `source` + `trigger` columns to `SweepRun` (Phase 2 currently
      hard-codes `'999.md'`/`'cron'`); (d) `durationMs = finishedAt -
      startedAt` (null when running) on the `/api/sweeps` projection
      (`src/web/routes/sweeps.ts:12`); (e) structured `progress` (phase,
      pagesDone/Total, queued) and `currentlyFetching` shape on
      SweepDetail. Depends on Phase 1 co-location.
      Plan: [`ui-redesign-port-kit.md`](./ui-redesign-port-kit.md). _Run via `/feature`._
- [ ] **Task 6 — contract + BDD tests** for every new route, BDD spec
      `specs/sweep-sse-stream.feature`, integration test that creates a
      `SweepRun` row with populated JSON columns.
      Plan: [`ui-redesign-port-kit.md`](./ui-redesign-port-kit.md). _Run via `/feature`._
- [ ] **CLAUDE_CODE_E2E.md cleanup.** Brief lives at repo root; once Phases
      1–4 ship, fold the still-relevant content into `docs/operator-ui.md`
      and delete the brief.
      Plan: [`ui-redesign-port-kit.md`](./ui-redesign-port-kit.md). _Run via `/feature`._

## Priority 1.5 — Backfill quality (newly tracked 2026-05-01)

- [ ] **Re-capture `GetAdvert` with the full feature selection set.** The
      currently-captured query in `src/graphql.ts` (timestamp
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

## Priority 3 — Acceptance criteria validation

- [ ] 7 consecutive days of hourly sweeps, ≥ 95% `status=ok`.
- [ ] ≥ 200 unique listings captured.
- [ ] Spot-check 10 random listings: parsed fields match the live page.
- [ ] Zero 403/429 across the week.
- [ ] At least one observed price change captured as a snapshot.

## Priority 4 — Later (post-POC backlog from spec §"High-level backlog")

- [ ] Phase 2: LLM scoring with Haiku 4.5 + prompt-cached rubric.
- [ ] Phase 3: Telegram bot delivery.
- [ ] Phase 4: React/Vite/Tailwind PWA on Cloudflare Pages.
- [ ] Phase 5: makler.md + lara.md sources, cross-source dedup.
- [ ] Phase 6: Capacitor wrap + Web Push.
- [ ] Phase 7: Telegram channel ingestion, vision LLM, sold-price calibration.

---

## Done

### POC crawler core (Priority 1)

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

### Operator UI + Postgres + Grafana (Priority 2)

Parent plan: [`operator-ui-postgres-grafana.md`](./operator-ui-postgres-grafana.md). All 7 slices shipped.

- [x] **Slice 1** — Postgres migration + per-process testcontainers, 147/147 green ([PR #6](https://github.com/SleepyDreamsDev/house-track/pull/6)). Plan: [`postgres-migration.md`](./postgres-migration.md).
- [x] **Slice 2** — `Setting` + `Source` tables, `src/settings.ts`, runtime override wiring in `sweep`/`fetch`/`circuit`.
- [x] **Slice 3** — Hono API layer + `web` service (sweeps/listings/filters/settings/sources/circuit) reusing `src/mcp/queries.ts`.
- [x] **Slice 4** — Vite SPA scaffold: react-router + TanStack Query/Table + shadcn primitives, 4 pages.
- [x] **Slice 5** — `frontend-design` visual pass over the 4 pages.
- [x] **Slice 6** — Grafana provisioning + Dashboard-page iframe.
- [x] **Slice 7** — Docs: `docs/operator-ui.md`, poc-spec append, CLAUDE.md Stack/Quick-Start update.

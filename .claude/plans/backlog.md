# house-track — Backlog

## Priority 1 — Current Sprint (POC, per `docs/poc-spec.md`)

- [x] Implement `src/circuit.ts` — sentinel file `data/.circuit_open`; threshold + 24h cooldown. _8 tests._
- [x] Implement `src/fetch.ts` — undici client, 8s±2s jitter, retries (10s/30s/90s on 5xx + network err), 403/429 → CircuitTrippingError. Politeness profile fixes (Origin/Referer/Sec-Fetch-*; HTML interstitial → breaker; per-call delayMs override). _25 tests._
- [x] Implement `src/persist.ts` — Prisma upsert + snapshot insert when hash changes; markSeen / markInactiveOlderThan / sweep bookkeeping; `$transaction`-atomic ListingFilterValue write; `findUnenrichedListings` for backfill. _16 tests._
- [x] Implement `src/sweep.ts` — orchestrator + trickle-backfill of unenriched listings (`SWEEP.backfillPerSweep`). _14 tests._
- [x] Implement `src/index.ts` — node-cron hourly entrypoint, wires real deps.
- [x] Add minimal `src/log.ts` smoke test. _2 tests._
- [x] Replace placeholder filter params in `src/config.ts` with real 999.md IDs (verified GraphQL filter IDs 2026-04-26).
- [x] Save 1 index page + advert detail page from 999.md to `src/__tests__/fixtures/`.
- [x] Implement `src/parse-index.ts` — JSON parser (GraphQL, not HTML). _13 tests._
- [x] Implement `src/parse-detail.ts` — JSON parser + `extractFilterValues` walk over FEATURE_* entries. _19 tests._
- [x] Schema enrichment: `ListingFilterValue` table with facet indexes; `Listing.filterValuesEnrichedAt` for backfill scheduling.
- [x] Local MCP server (`src/mcp/server.ts`) over stdio with three read-only tools: `list_filters`, `search_listings`, `get_listing`. _18 query tests._
- [x] First migration via `pnpm prisma migrate dev --name init` (and `add_listing_filter_value`).
- [ ] Verify `https://999.md/robots.txt` allows the planned crawl (spec §"Politeness budget").
- [ ] Local Docker compose smoke test against the named volume.

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

## Priority 2 — Operator UI + Postgres + Grafana (newly tracked 2026-05-02)

Parent plan: [`operator-ui-postgres-grafana.md`](./operator-ui-postgres-grafana.md).
Delivers `docs/poc-spec.md` Phase 4 (operator UI) earlier than originally
sequenced. Single localhost-only stack: `crawler` + `postgres` + `grafana`
+ `web`. Sliced for incremental shipping per slice = its own session +
commit.

- [x] **Slice 1 — Postgres migration + testcontainers.** Plan: [`postgres-migration.md`](./postgres-migration.md). SQLite → pg, fresh `0_init`, per-Vitest-process testcontainer, 147/147 tests green. PR [#6](https://github.com/SleepyDreamsDev/house-track/pull/6).
- [ ] **Slice 2 — `Setting` + `Source` tables + `getSetting`.** New tables, `src/settings.ts`, refactor `sweep.ts`/`fetch.ts`/`circuit.ts` to read overrides; `src/config.ts` stays as defaults. _Run via `/feature`._
- [ ] **Slice 3 — Hono API layer + `web` service.** `src/web/server.ts` + routes (sweeps/listings/filters/settings/sources/circuit) reusing `src/mcp/queries.ts`. _Run via `/feature-parallel` with 4–6._
- [ ] **Slice 4 — Vite SPA scaffold + 4 pages.** `web/` Vite + react-router + TanStack Query/Table + shadcn primitives. Functional but unstyled. _Run via `/feature-parallel` with 3, 5, 6._
- [ ] **Slice 5 — `frontend-design` visual pass.** Apply `frontend-design` skill to the 4 pages per parent plan §"Visual pass". _Run via `/feature-parallel` with 3, 4, 6._
- [ ] **Slice 6 — Grafana provisioning + iframe.** `grafana/provisioning/*`, dashboard JSON, Dashboard-page iframe. _Run via `/feature-parallel` with 3, 4, 5._
- [ ] **Slice 7 — Docs.** `docs/operator-ui.md`, poc-spec append, `CLAUDE.md` Stack/Quick-Start update. _Run via `/feature` or plain edits._

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

<!-- Completed items are moved here with [x] and a brief note -->

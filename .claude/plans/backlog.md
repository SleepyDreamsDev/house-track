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

## Priority 2 — Acceptance criteria validation

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

<!-- Completed items are moved here with [x] and a brief note -->

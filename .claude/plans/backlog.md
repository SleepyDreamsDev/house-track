# house-track — Backlog

## Priority 1 — Current Sprint (POC, per `docs/poc-spec.md`)

- [x] Implement `src/circuit.ts` — sentinel file `data/.circuit_open`; threshold + 24h cooldown. _7 tests._
- [x] Implement `src/fetch.ts` — undici client, 8s±2s jitter, retries (10s/30s/90s on 5xx + network err), 403/429 → CircuitTrippingError. _10 tests._
- [x] Implement `src/persist.ts` — Prisma upsert + snapshot insert when hash changes; markSeen / markInactiveOlderThan / sweep bookkeeping. _10 tests._
- [x] Implement `src/sweep.ts` — orchestrator (extracted from index.ts for testability). _7 tests._
- [x] Implement `src/index.ts` — node-cron hourly entrypoint, wires real deps.
- [x] Add minimal `src/log.ts` smoke test. _2 tests._
- [ ] Replace placeholder filter params in `src/config.ts` with real 999.md IDs (open browser, apply filters, copy URL).
- [ ] Save 1 index page + 2–3 detail pages from 999.md to `src/__tests__/fixtures/`.
- [ ] Implement `src/parse-index.ts` — cheerio against the saved fixture.
- [ ] Implement `src/parse-detail.ts` — cheerio against fixtures, including normalized `rawHtmlHash`.
- [ ] Verify `https://999.md/robots.txt` allows the planned crawl (spec §"Politeness budget").
- [ ] First migration via `pnpm prisma migrate dev --name init`.
- [ ] Local Docker compose smoke test against the named volume.

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

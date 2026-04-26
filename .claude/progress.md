# Session Progress — house-track

> Auto-injected at session start. Update this file at the end of each session.

**Last updated:** 2026-04-26
**Branch:** `claude/scaffold-house-track-EW7gc` (PR #1 merged into main)
**Last commit:** _io-layer impl pending_

---

## Current state

I/O-layer implementation done via TDD. **36/36 tests pass.**

| Module | Status | Tests |
|---|---|---|
| `src/circuit.ts` | DONE — sentinel-file breaker, threshold + cooldown | 7 |
| `src/fetch.ts` | DONE — undici client, 8s±jitter spacing, 5xx retries (10/30/90s), 403/429 → CircuitTrippingError | 10 |
| `src/persist.ts` | DONE — Prisma upsert, snapshot diff on rawHtmlHash, sweep round-trip | 10 |
| `src/sweep.ts` | DONE — orchestrator: pre-flight → paginate → diff → fetch+parse+persist details → markSeen → markInactiveOlderThan → finishSweep | 7 |
| `src/log.ts` | DONE — pino w/ service binding | 2 |
| `src/index.ts` | DONE — wires all the above + node-cron | (no test — too thin) |
| `src/parse-index.ts` | STUB — needs real 999.md HTML fixture | — |
| `src/parse-detail.ts` | STUB — needs real 999.md HTML fixtures | — |
| `src/config.ts` | STUB params — needs `o_<id>_<id>` keys from real 999.md filter URL | — |

Tooling: pnpm install ✓, prisma generate ✓, prisma db push (per test) ✓,
typecheck ✓, lint ✓, prettier ✓, build ✓.

Sandbox limitation: 999.md is not on the host allowlist (curl returns "Host not
in allowlist", WebFetch returns 403). Can't fetch fixtures or verify robots.txt
from inside the sandbox — that's a local-machine task for the human.

## Next session

1. Save 1 index page + 2–3 detail pages from 999.md to `src/__tests__/fixtures/`.
2. Paste the real filter URL → extract `o_<id>_<id>=<value>` params into `src/config.ts`.
3. TDD `parse-index.ts` against the saved fixture (RED → GREEN → REFACTOR).
4. TDD `parse-detail.ts` against the saved fixtures, including `rawHtmlHash`
   normalization (strip nav/footer/ads).
5. End-to-end smoke run: `RUN_ONCE=1 pnpm dev` against the real 999.md.
6. `docker compose up --build -d` and watch one tick.

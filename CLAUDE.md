# house-track — Claude Code Reference

## Stack

Node 22 + TS strict (NodeNext/ESM) · `undici` · `cheerio` · `node-cron` ·
SQLite/Prisma · `pino` · Vitest · pnpm · Docker Compose.

Source of truth for scope, crawl flow, politeness budget, and acceptance
criteria: [`docs/poc-spec.md`](./docs/poc-spec.md). Read before editing `src/`.

## Commands

| Task        | Command                                                         |
| ----------- | --------------------------------------------------------------- |
| Setup       | `pnpm install && pnpm prisma generate`                          |
| First-run   | `pnpm prisma migrate dev --name init`                           |
| Dev         | `pnpm dev` (watch) / `pnpm start` (compiled)                    |
| Test        | `pnpm test` / `pnpm test:watch` / `pnpm test:coverage`          |
| Type / Lint | `pnpm typecheck` / `pnpm lint` (`:fix`) / `pnpm format`         |
| Build       | `pnpm build`                                                    |
| Prisma      | `pnpm prisma:migrate` / `pnpm prisma:studio`                    |
| Docker      | `docker compose up --build -d` / `... logs -f property-crawler` |

## Project-Specific Rules

- **Politeness is non-negotiable.** 8s±2s gap, concurrency 1, realistic
  Firefox UA, no cookies. Detail fetches use `POLITENESS.detailDelayMs=10s`.
  See `docs/poc-spec.md` §"Politeness budget".
- **Param IDs in 999.md URLs are opaque** (`o_30_237=775`) and shift across
  category trees. Always copy from a real browser session — never guess.
- **Price normalization:** ~90% EUR; watch for MDL/USD. Always store
  `priceRaw` for audit; normalize separately.
- **TZ matters.** `docker-compose.yml` sets `TZ=Europe/Chisinau` so SQLite's
  naive `datetime('now')` matches local cron behavior.
- **Circuit breaker is manual to clear.** Delete `data/.circuit_open` after
  investigating a 24h pause.

## Conventions

- Conventional Commits (commitlint). Scopes: `fetch`, `parse`, `persist`,
  `cron`, `circuit`, `db`, `docker`, `config`, `log`, `mcp`.
- Branches: `feature/<slug>` or `fix/<slug>`. Squash-merge to main, delete after.
- TS strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. ESM
  only — `.js` extensions in relative imports. No comments unless the WHY
  is non-obvious.
- Tests: integration > unit > edge cases. Cheerio fixtures in
  `src/__tests__/fixtures/*.html`. Mock `undici` via `MockAgent` — never
  hit 999.md. Prisma uses temp SQLite per test. Coverage target 70%.
- Gherkin specs in `specs/*.feature`, one per feature/PR. Each `Scenario:`
  maps to one `it()`.

## Rules

Detailed rules live in dedicated files:

- TDD workflow: `.claude/rules/tdd-workflow.md`
- Session reporting: `.claude/rules/session-reporting.md`
- Framework boundary: `.claude/rules/framework-boundary.md`
- Plugin gate: `.claude/rules/plugin-gate.md`
- Token discipline: `.claude/rules/token-discipline.md`

## Session Discipline

- Update `.claude/progress.md` at end of each session (≤30 lines, history
  in `progress-archive.md`).
- `/compact` after each phase (RED/GREEN/REFACTOR) — don't wait for the warning.
- Do NOT edit `CLAUDE.md` or `progress.md` mid-session (breaks cache).

## Skills

- `/feature [--careful] <description>` — TDD cycle: spec → tests → impl → refactor.
- `/fix [<description>]` — Lightweight fix path.
- `/security [files|ref]` — Threat-modeling review (defaults to unstaged).
- `/feature-parallel <description>` — Parallel multi-domain variant.

## References

- [POC spec](./docs/poc-spec.md) — source of truth
- [Framework architecture](./docs/framework-architecture.md)
- [TDD guide](./docs/tdd-guide.md)
- [Solo-dev SDLC blueprint](./docs/solo-dev-sdlc-blueprint.md)

# house-track — Claude Code Reference

## Tech Stack

- Node 22 LTS, TypeScript strict (NodeNext / ESM)
- Fetcher: `undici` (Playwright fallback if any page becomes JS-only)
- Parser: `cheerio`
- Scheduler: `node-cron` (hourly sweep)
- DB: SQLite via Prisma (file lives on a Docker named volume)
- Logging: `pino` (JSON to stdout → `docker logs`)
- Tests: Vitest
- Container: Docker Compose (alongside Home Assistant on the ZBook)
- Package manager: pnpm

## Quick Start

```bash
pnpm install
pnpm prisma generate
pnpm prisma migrate dev --name init    # first run only
pnpm dev                                # tsx watch — single sweep loop for local iteration
pnpm test                               # vitest
pnpm typecheck                          # tsc --noEmit

# Docker (production-equivalent)
docker compose up --build -d
docker compose logs -f property-crawler
```

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Type-check | `pnpm typecheck` |
| Lint | `pnpm lint` (`pnpm lint:fix` to auto-fix) |
| Format | `pnpm format` |
| Tests | `pnpm test` (`pnpm test:watch` / `pnpm test:coverage`) |
| Build | `pnpm build` |
| Run | `pnpm start` (compiled) / `pnpm dev` (watch) |
| Prisma migrate | `pnpm prisma:migrate` |
| Prisma studio | `pnpm prisma:studio` |
| Docker up | `docker compose up --build -d` |
| Docker logs | `docker compose logs -f property-crawler` |

## Architecture

```
house-track/
├── src/
│   ├── index.ts          # cron entrypoint — orchestrates one sweep per tick
│   ├── config.ts         # hardcoded FILTER (Phase 1; YAML loader later)
│   ├── fetch.ts          # undici client w/ rate limit, retry, UA
│   ├── parse-index.ts    # cheerio: index page → listing stubs
│   ├── parse-detail.ts   # cheerio: detail page → full Listing
│   ├── persist.ts        # Prisma upsert + snapshot diff
│   ├── circuit.ts        # 3×fail → 24h pause (sentinel file)
│   ├── log.ts            # pino setup
│   └── types.ts          # shared types
├── prisma/
│   └── schema.prisma     # Listing, ListingSnapshot, SweepRun
├── data/                 # named volume in Docker; local SQLite for dev
├── docs/
│   ├── poc-spec.md                 # source of truth — all decisions live here
│   ├── framework-architecture.md   # claude-tdd-starter framework design
│   ├── solo-dev-sdlc-blueprint.md  # solo dev workflow
│   └── tdd-guide.md                # RED-GREEN-REFACTOR
├── specs/                # Gherkin acceptance criteria (one .feature per PR)
├── Dockerfile
├── docker-compose.yml
└── CLAUDE.md
```

The full POC scope, crawl flow, politeness budget, failure handling, and
acceptance criteria live in [`docs/poc-spec.md`](./docs/poc-spec.md). Read it
before implementing anything in `src/`.

## Conventions

### Commits

Follow Conventional Commits (enforced by commitlint):

- `feat(scope): add new feature`
- `fix(scope): fix a bug`
- `chore(scope): tooling, deps, config`
- `docs: documentation changes`
- `test(scope): add or fix tests`
- `refactor(scope): restructure code`

Scopes: `fetch`, `parse`, `persist`, `cron`, `circuit`, `db`, `docker`, `config`, `log`

### Branching

- Feature: `feature/short-description`
- Fix: `fix/issue-description`
- Squash merge to main, delete after merge.

### Code Style

- TypeScript strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- ESLint + Prettier (auto-formatted by hooks)
- Import order: external → internal → relative
- ESM only (`"type": "module"`); use `.js` extensions in relative imports
- Default to no comments; explain only the non-obvious WHY

### Test Runner Reference

| Goal | Command |
|---|---|
| Run once | `pnpm test` |
| Watch | `pnpm test:watch` |
| Coverage (≥ 70%) | `pnpm test:coverage` |
| Single file | `pnpm vitest run src/parse-index.test.ts` |

### Test Utilities

- Cheerio fixtures live in `src/__tests__/fixtures/*.html` (saved once from a real 999.md page).
- For HTTP, mock `undici` via `MockAgent` — never hit 999.md from tests.
- For Prisma, use a temp SQLite file per test (`file::memory:?cache=shared` or a temp path).

### Gherkin Specs

- Feature specs live in `specs/*.feature`.
- Written BEFORE tests as human-readable acceptance criteria.
- Not executable — documentation that maps to test `describe`/`it` blocks.
- One `.feature` file per feature/PR.
- Created automatically by `/feature` skill in PHASE 1.5 (SPECIFY).

## Rules

Detailed rules live in dedicated files — read them for the full constraints:

- **TDD workflow:** `.claude/rules/tdd-workflow.md`
- **Session reporting:** `.claude/rules/session-reporting.md`
- **Framework boundary:** `.claude/rules/framework-boundary.md`
- **Plugin gate:** `.claude/rules/plugin-gate.md`
- **Project-specific technical rules:** `.claude/rules/technical.md` _(create as needed)_

## Session Discipline

- Update `.claude/progress.md` at the end of each session — the `session-start.sh` hook injects it into every new session's context.
- `/compact` after each completed phase (RED / GREEN / REFACTOR) — don't wait for the warning.

## Available Skills

- `/feature [--careful] <description>` — Orchestrated TDD cycle: Gherkin spec → tests → implement → refactor → ship.
  Default: FAST_MODE — combined RED+GREEN, auto-approve Gherkin, parallel validation.
  `--careful`: forces PAUSE for Gherkin approval and separate RED/GREEN steps.
- `/fix [<description>]` — Lightweight bug fix path. Locate → scope check → fix → verify → commit.
- `/security [files or git ref]` — Deep security review with threat modeling. Defaults to reviewing unstaged changes.
- `/feature-parallel <description>` — Parallel variant for multi-domain features.

## Project-Specific Notes

- **Politeness is non-negotiable.** 8s±2s delay between requests, concurrency 1, realistic Firefox UA, no cookies. See `docs/poc-spec.md` §"Politeness budget".
- **Param IDs in 999.md URLs are opaque** (`o_30_237=775`) and shift across category trees. Always copy from a real browser session — never guess.
- **Price normalization:** ~90% EUR but watch for MDL/USD. Always store `priceRaw` for audit; normalize separately.
- **TZ matters.** `docker-compose.yml` sets `TZ=Europe/Chisinau` so SQLite's naive `datetime('now')` matches local cron behavior.
- **Circuit breaker is manual to clear.** Delete `data/.circuit_open` after investigating a 24h pause.

## References

- [POC spec](./docs/poc-spec.md) — source of truth
- [Framework architecture](./docs/framework-architecture.md)
- [TDD guide](./docs/tdd-guide.md)
- [Solo-dev SDLC blueprint](./docs/solo-dev-sdlc-blueprint.md)

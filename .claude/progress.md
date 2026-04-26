# Session Progress — house-track

> Auto-injected at session start. Update this file at the end of each session.

**Last updated:** 2026-04-26
**Branch:** `claude/scaffold-house-track-EW7gc`
**Last commit:** _scaffold pending_

---

## Current state

Initial scaffold from `claude-tdd-starter` (TDD framework + express-simple
preset adapted for a cron-driven crawler). All `src/` files are stubs with
TODOs that reference sections of `docs/poc-spec.md`.

What's wired:

- `.claude/` framework (agents, hooks, skills, rules, settings)
- `.husky` + commitlint
- `package.json` with crawler deps (undici, cheerio, node-cron, prisma, pino)
- `tsconfig.json` (strict, NodeNext, Node 22 target)
- `vitest.config.ts`
- Prisma schema (`Listing`, `ListingSnapshot`, `SweepRun`) per spec §"Database schema"
- `Dockerfile` + `docker-compose.yml` per spec §"Docker Compose"

What's NOT wired (deliberate — empty stubs):

- HTTP fetch / retry / rate-limiting (`src/fetch.ts`)
- Cheerio selectors (`src/parse-index.ts`, `src/parse-detail.ts`)
- Prisma upsert + snapshot diffing (`src/persist.ts`)
- Circuit breaker file logic (`src/circuit.ts`)
- Cron entrypoint orchestration (`src/index.ts`)
- 999.md filter param IDs (`src/config.ts` — must be copied from a real browser session, see spec §"Hardcoded filter")

## Next session

1. `pnpm install` and verify `pnpm typecheck` passes against the stubs.
2. Run `pnpm prisma migrate dev --name init` to generate the initial migration.
3. Manually visit 999.md, apply filters, copy URL → fill in `src/config.ts` param IDs.
4. Use `/feature` skill to drive RED→GREEN→REFACTOR for `parse-index.ts` first
   (smallest scope, no I/O).

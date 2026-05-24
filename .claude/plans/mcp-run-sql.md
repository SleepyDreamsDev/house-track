# Plan: MCP `run_sql` — open-ended "ask the data"

Source of truth: `docs/superpowers/specs/2026-05-24-mcp-run-sql-design.md` (approved).

## Goal
Add a guarded read-only `run_sql` MCP tool + a `schema://house-track` resource + a
sweep-aware in-memory result cache to the existing stdio MCP server.

## Acceptance Criteria
- [ ] `validateSql` rejects non-`SELECT`/`WITH`, multi-statement, and empty input (pure, unit-tested).
- [ ] Validator strips comments + string literals before counting statements (hidden `;`/`DROP` defeated).
- [ ] Trailing `;`/comments stripped, query wrapped as `SELECT * FROM (<sql>) AS _q LIMIT 500`.
- [ ] `run_sql` executes on a `DATABASE_URL_RO` `pg` pool (NOT Prisma); statement_timeout 5s.
- [ ] DB read-only role blocks DML-in-CTE (`WITH … INSERT … RETURNING`) — backstop.
- [ ] Result serialized BigInt-safe; payload capped ~100 KB with `truncated` flag.
- [ ] In-memory LRU (~50) keyed `hash(wrappedSql):max(SweepRun.finishedAt)`; new sweep busts.
- [ ] Cache hit returns `cached:true` without re-running the data query; errors never cached.
- [ ] `DATABASE_URL_RO` unset → graceful "not configured" error; other 3 tools unaffected.
- [ ] `schema://house-track` resource serves raw `prisma/schema.prisma` + preamble, memoized.
- [ ] `scripts/create-ro-role.sql`, `.env.example`, docker-compose, docs, setup-mcp updated.

## Tasks
1. RED: `src/__tests__/sql-runner.test.ts` (unit validator/serializer + integration via RO role) and `src/__tests__/schema-resource.test.ts`.
2. GREEN: `src/mcp/sql-runner.ts`, `src/mcp/schema-resource.ts`.
3. Wire: register tool + resource in `src/mcp/server.ts`; fix stale "SQLite" comment.
4. Ops: `scripts/create-ro-role.sql`, docker-compose init, `.env.example`, `setup-mcp.ts`, `docs/mcp-setup.md`.
5. REFACTOR + full validation (typecheck/lint/test) + ship.

## File Map
| Action | File | Notes |
|--------|------|-------|
| create | src/mcp/sql-runner.ts | validator + pg pool + LRU + serialize |
| create | src/mcp/schema-resource.ts | memoized schema text + preamble |
| create | src/__tests__/sql-runner.test.ts | unit + integration (RO role in-container) |
| create | src/__tests__/schema-resource.test.ts | memoization + table coverage |
| create | scripts/create-ro-role.sql | GRANT SELECT only role |
| modify | src/mcp/server.ts | register run_sql + schema resource; fix comment |
| modify | scripts/setup-mcp.ts | inject DATABASE_URL_RO into Desktop env (optional) |
| modify | docker-compose.yml | mount + run create-ro-role.sql on init |
| modify | .env.example | add DATABASE_URL_RO |
| modify | docs/mcp-setup.md | document RO role + run_sql + fix SQLite text |

## Verification
- `pnpm typecheck && pnpm lint`
- `pnpm test src/__tests__/sql-runner.test.ts src/__tests__/schema-resource.test.ts`
- Full `pnpm test`.

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_BYTES,
  NotConfiguredError,
  ROW_LIMIT,
  SqlRunner,
  SqlValidationError,
  serializeRows,
  validateSql,
} from '../mcp/sql-runner.js';

// ─────────────────────────────── unit: validateSql ───────────────────────────────

describe('validateSql', () => {
  it('Accept a plain SELECT', () => {
    const r = validateSql('SELECT 1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.wrapped).toMatch(/SELECT \* FROM \(/i);
      expect(r.wrapped).toMatch(new RegExp(`LIMIT ${ROW_LIMIT}`));
    }
  });

  it('Accept a WITH (CTE) query', () => {
    expect(validateSql('WITH t AS (SELECT 1 AS n) SELECT n FROM t').ok).toBe(true);
  });

  it('Reject a non-SELECT statement', () => {
    const r = validateSql('UPDATE "Listing" SET active = false');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/select/i);
  });

  it('Reject multiple statements', () => {
    const r = validateSql('SELECT 1; DROP TABLE "Listing"');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/statement/i);
  });

  it('Accept a single statement with a DROP hidden in a literal and comment', () => {
    const r = validateSql("SELECT '; DROP TABLE x' /* ; still one statement */");
    expect(r.ok).toBe(true);
  });

  it('Reject empty input', () => {
    expect(validateSql('').ok).toBe(false);
    expect(validateSql('   ').ok).toBe(false);
  });

  it('Strip a trailing semicolon before wrapping', () => {
    const r = validateSql('SELECT 1;');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.wrapped.includes(';')).toBe(false);
  });

  it('Defends against a trailing line comment eating the closing paren', () => {
    const r = validateSql('SELECT 1 -- trailing');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.wrapped).toMatch(/\n\)\s*AS _q/);
  });

  it('Rejects an unterminated block comment (LIMIT-wrap escape, appsec HIGH-1)', () => {
    const r = validateSql('SELECT id FROM "Listing") AS x UNION SELECT id FROM "Listing" /*');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unterminated|comment/i);
  });

  it('Rejects an unterminated string literal', () => {
    expect(validateSql("SELECT 'oops").ok).toBe(false);
  });

  it('Rejects an unterminated dollar-quoted string', () => {
    expect(validateSql('SELECT $$oops').ok).toBe(false);
  });

  it('Accepts an E-string with a backslash-escaped quote (appsec MEDIUM-2)', () => {
    // E'a\'b' is a single string literal "a'b" — the escaped quote must not be
    // treated as the terminator.
    const r = validateSql("SELECT E'a\\'b' AS s");
    expect(r.ok).toBe(true);
  });
});

// ─────────────────────────────── unit: serializeRows ───────────────────────────────

describe('serializeRows', () => {
  it('Serializes BigInt values without throwing and renders them as strings', () => {
    const { rows } = serializeRows([{ c: 42n }]);
    expect(() => JSON.stringify(rows)).not.toThrow();
    expect((rows[0] as { c: unknown }).c).toBe('42');
  });

  it('Caps an oversized payload and flags truncated', () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({ i, blob: 'x'.repeat(200) }));
    const { rows, truncated } = serializeRows(big);
    expect(truncated).toBe(true);
    expect(rows.length).toBeLessThan(big.length);
    expect(Buffer.byteLength(JSON.stringify(rows))).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('Keeps at least one row even if it alone exceeds the cap', () => {
    const { rows, truncated } = serializeRows([{ blob: 'x'.repeat(MAX_BYTES + 100) }]);
    expect(rows).toHaveLength(1);
    expect(truncated).toBe(false);
  });
});

// ─────────────────────────────── integration: SqlRunner ───────────────────────────────

let prisma: PrismaClient;
let adminPool: Pool;
let roUrl: string;
let roRole: string;
let dbName: string;

beforeAll(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set — vitest setup must run first');
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  const u = new URL(dbUrl);
  dbName = u.pathname.slice(1);
  roRole = `ro_${dbName}`;
  const pw = 'ro_pw';

  adminPool = new Pool({ connectionString: dbUrl });
  await adminPool.query(`CREATE ROLE ${roRole} LOGIN PASSWORD '${pw}'`);
  await adminPool.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${roRole}`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO ${roRole}`);
  await adminPool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${roRole}`);
  // Mirror production (scripts/create-ro-role.sql) exactly — both session guards.
  await adminPool.query(`ALTER ROLE ${roRole} SET default_transaction_read_only = on`);
  await adminPool.query(`ALTER ROLE ${roRole} SET statement_timeout = '5s'`);

  u.username = roRole;
  u.password = pw;
  roUrl = u.toString();
});

afterAll(async () => {
  await prisma.$disconnect();
  await adminPool.query(`DROP OWNED BY ${roRole}`).catch(() => undefined);
  await adminPool.query(`DROP ROLE IF EXISTS ${roRole}`).catch(() => undefined);
  await adminPool.end();
});

beforeEach(async () => {
  await prisma.listingSnapshot.deleteMany();
  await prisma.listingFilterValue.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.sweepRun.deleteMany();
});

async function seed(id: string, priceEur: number, district: string): Promise<void> {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/ro/${id}`,
      title: `Title ${id}`,
      lastSeenAt: now,
      lastFetchedAt: now,
      firstSeenAt: now,
      priceEur,
      district,
      // mirror persist.ts: a listing always has a current-price snapshot
      snapshots: { create: { priceEur, rawHtmlHash: `hash-${id}` } },
    },
  });
}

describe('SqlRunner — read-only execution', () => {
  it('Runs an aggregate query and returns one row per district', async () => {
    await seed('1', 50_000, 'Botanica');
    await seed('2', 90_000, 'Botanica');
    await seed('3', 150_000, 'Centru');
    const runner = new SqlRunner({ connectionString: roUrl });

    const res = await runner.run(
      'SELECT district, avg("priceEur")::int AS avg FROM "Listing" GROUP BY district ORDER BY district',
    );

    expect(res.rowCount).toBe(2);
    expect(res.cached).toBe(false);
    expect(res.sqlExecuted).toMatch(/LIMIT 500/);
    await runner.close();
  });

  it('count(*) comes back usable', async () => {
    await seed('1', 10, 'X');
    await seed('2', 20, 'X');
    const runner = new SqlRunner({ connectionString: roUrl });

    const res = await runner.run('SELECT count(*) AS c FROM "Listing"');

    expect(String((res.rows[0] as { c: unknown }).c)).toBe('2');
    await runner.close();
  });

  it('The read-only role blocks a data-modifying CTE and inserts nothing', async () => {
    await seed('1', 10, 'X');
    const runner = new SqlRunner({ connectionString: roUrl });

    await expect(
      runner.run(
        `WITH x AS (INSERT INTO "Listing"(id,url,title,"lastSeenAt","lastFetchedAt") VALUES ('hack','u','t',now(),now()) RETURNING id) SELECT * FROM x`,
      ),
    ).rejects.toThrow();

    expect(await prisma.listing.count()).toBe(1);
    await runner.close();
  });

  it('Rejects a non-SELECT before touching the database', async () => {
    const runner = new SqlRunner({ connectionString: roUrl });
    await expect(runner.run('DELETE FROM "Listing"')).rejects.toThrow(/select/i);
    await runner.close();
  });

  it('Rejects the block-comment row-cap escape before executing (appsec HIGH-1)', async () => {
    await seed('1', 10, 'X');
    const runner = new SqlRunner({ connectionString: roUrl });
    await expect(
      runner.run('SELECT id FROM "Listing") AS x UNION SELECT id FROM "Listing" /*'),
    ).rejects.toThrow(SqlValidationError);
    await runner.close();
  });

  it('The read-only test role mirrors production session guards (appsec LOW-5)', async () => {
    const { rows } = await adminPool.query<{ rolconfig: string[] | null }>(
      `SELECT rolconfig FROM pg_roles WHERE rolname = $1`,
      [roRole],
    );
    const cfg = (rows[0]?.rolconfig ?? []).join(',');
    expect(cfg).toMatch(/default_transaction_read_only=on/);
    expect(cfg).toMatch(/statement_timeout=/);
  });

  it('statement_timeout aborts a runaway query', async () => {
    const runner = new SqlRunner({ connectionString: roUrl, statementTimeoutMs: 300 });
    await expect(runner.run('SELECT pg_sleep(2)')).rejects.toThrow();
    await runner.close();
  });

  it('Reports "not configured" when no connection string is available', async () => {
    const prev = process.env.DATABASE_URL_RO;
    delete process.env.DATABASE_URL_RO;
    const runner = new SqlRunner({});
    expect(runner.configured).toBe(false);
    await expect(runner.run('SELECT 1')).rejects.toThrow(NotConfiguredError);
    if (prev !== undefined) process.env.DATABASE_URL_RO = prev;
    await runner.close();
  });
});

describe('SqlRunner — caching', () => {
  const SQL = 'SELECT count(*) AS c FROM "Listing"';

  function dataCalls(spy: ReturnType<typeof vi.spyOn>, wrapped: string): number {
    return spy.mock.calls.filter((c) => String(c[0]) === wrapped).length;
  }

  it('Serves an identical query from cache without re-running the data query', async () => {
    await seed('1', 10, 'X');
    const pool = makeRoPool();
    const runner = new SqlRunner({ pool });
    const spy = vi.spyOn(pool, 'query');
    const wrapped = (validateSql(SQL) as { ok: true; wrapped: string }).wrapped;

    const first = await runner.run(SQL);
    expect(first.cached).toBe(false);
    expect(dataCalls(spy, wrapped)).toBe(1);

    const second = await runner.run(SQL);
    expect(second.cached).toBe(true);
    expect(second.cachedAt).toBeTruthy();
    expect(dataCalls(spy, wrapped)).toBe(1); // data query NOT re-run

    spy.mockRestore();
    await pool.end();
  });

  it('A newly finished SweepRun busts the cache', async () => {
    await seed('1', 10, 'X');
    const pool = makeRoPool();
    const runner = new SqlRunner({ pool });
    const spy = vi.spyOn(pool, 'query');
    const wrapped = (validateSql(SQL) as { ok: true; wrapped: string }).wrapped;

    await runner.run(SQL);
    expect(dataCalls(spy, wrapped)).toBe(1);

    await prisma.sweepRun.create({ data: { status: 'ok', finishedAt: new Date() } });

    const after = await runner.run(SQL);
    expect(after.cached).toBe(false);
    expect(dataCalls(spy, wrapped)).toBe(2); // re-run because version advanced

    spy.mockRestore();
    await pool.end();
  });

  it('Does not cache failed queries', async () => {
    const pool = makeRoPool();
    const runner = new SqlRunner({ pool });
    const bad = 'SELECT * FROM "NoSuchTable"';

    await expect(runner.run(bad)).rejects.toThrow();
    await expect(runner.run(bad)).rejects.toThrow(); // still errors, not a cached success

    await pool.end();
  });
});

function makeRoPool(): Pool {
  return new Pool({
    connectionString: roUrl,
    max: 2,
    statement_timeout: 5000,
    options: '-c default_transaction_read_only=on',
  });
}

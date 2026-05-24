// Guarded read-only SQL execution for the MCP `run_sql` tool.
//
// Defense in depth: this module assumes it connects as a Postgres role that has
// only SELECT (DATABASE_URL_RO). On top of that DB-level backstop it adds an
// app-level pipeline — single-statement SELECT/WITH allowlist, row + byte caps,
// statement_timeout — so writes and runaway queries are rejected before they
// reach the database, with clean error messages.
//
// Uses the `pg` driver directly (NOT Prisma): we need a dedicated read-only
// pool and per-connection statement_timeout, which Prisma does not expose for
// ad-hoc queries. The three curated tools in queries.ts keep using Prisma.

import { createHash } from 'node:crypto';

import { Pool } from 'pg';

export const ROW_LIMIT = 500;
export const MAX_BYTES = 100_000;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000;
const CACHE_MAX = 50;

// Constant probe — kept distinct from any user query so cache logic and call
// spies can tell the version probe apart from the data query.
const VERSION_SQL = 'SELECT max("finishedAt") AS v FROM "SweepRun"';

const DOLLAR_TAG = /^\$([A-Za-z0-9_]*)\$/;

export class NotConfiguredError extends Error {
  constructor(message = 'run_sql is not configured — set DATABASE_URL_RO (see docs/mcp-setup.md)') {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

export class SqlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlValidationError';
  }
}

export type ValidationResult = { ok: true; wrapped: string } | { ok: false; reason: string };

interface Skeleton {
  /** Code with comments/literals removed — safe to scan for `;` and keywords. */
  text: string;
  /**
   * True if scanning ended inside an open block comment, string, or
   * dollar-quote. Such a construct would swallow the wrapper tokens appended in
   * validateSql (the `) AS _q LIMIT 500`), so the query must be rejected.
   */
  unterminated: boolean;
}

/**
 * Strip SQL comments and string/identifier/dollar-quoted literals, leaving a
 * "skeleton" safe to scan for statement separators and the leading keyword.
 * Hidden `;` or `DROP` inside literals or comments is removed here. Reports
 * whether the input ended inside an unterminated construct.
 */
function skeleton(sql: string): Skeleton {
  let out = '';
  let i = 0;
  let unterminated = false;
  const n = sql.length;
  while (i < n) {
    const c = sql[i] as string;
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      // Line comment ends at EOL (or EOF) — never swallows the wrapper, since
      // validateSql puts a newline before the closing paren.
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl;
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) {
        unterminated = true;
        i = n;
      } else {
        i = end + 2;
      }
    } else if (c === "'") {
      // E-strings (E'…') use backslash escapes; plain strings only double the
      // quote ('') to escape. Detect the E/e prefix on the opening quote.
      const prev = i > 0 ? (sql[i - 1] as string) : '';
      const prev2 = i > 1 ? (sql[i - 2] as string) : '';
      const isEString = (prev === 'e' || prev === 'E') && !/[A-Za-z0-9_]/.test(prev2);
      i += 1;
      let closed = false;
      while (i < n) {
        if (isEString && sql[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) unterminated = true;
    } else if (c === '"') {
      i += 1;
      let closed = false;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) unterminated = true;
      out += 'x'; // keep a token so identifier boundaries survive
    } else if (c === '$') {
      const m = sql.slice(i).match(DOLLAR_TAG);
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) {
          unterminated = true;
          i = n;
        } else {
          i = end + tag.length;
        }
      } else {
        out += c;
        i += 1;
      }
    } else {
      out += c;
      i += 1;
    }
  }
  return { text: out, unterminated };
}

/** Validate raw SQL and, if safe, return the wrapped form to execute. Pure. */
export function validateSql(raw: string, rowLimit: number = ROW_LIMIT): ValidationResult {
  if (raw.trim() === '') return { ok: false, reason: 'Empty query.' };

  const scan = skeleton(raw);
  if (scan.unterminated) {
    return { ok: false, reason: 'Unterminated string, comment, or quoted literal.' };
  }
  const skel = scan.text.trim();
  if (skel === '') return { ok: false, reason: 'Query is only comments/whitespace.' };

  if (!/^(select|with)\b/i.test(skel)) {
    return { ok: false, reason: 'Only read-only SELECT (or WITH … SELECT) queries are allowed.' };
  }

  // After dropping a single trailing separator, no `;` may remain.
  const noTrailing = skel.replace(/[\s;]+$/, '');
  if (noTrailing.includes(';')) {
    return { ok: false, reason: 'Only a single statement is allowed.' };
  }

  // Execute the ORIGINAL sql (literals intact), with trailing separators
  // removed. The leading newline before `)` defeats a trailing line comment.
  const body = raw.replace(/[\s;]+$/, '');
  const wrapped = `SELECT * FROM (\n${body}\n) AS _q LIMIT ${rowLimit}`;
  return { ok: true, wrapped };
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export interface SerializeResult {
  rows: unknown[];
  truncated: boolean;
}

/**
 * Normalize rows to JSON-safe values (BigInt → string) and drop trailing rows
 * once the serialized payload would exceed `maxBytes`. At least one row is
 * always kept.
 */
export function serializeRows(input: unknown[], maxBytes: number = MAX_BYTES): SerializeResult {
  const normalized = JSON.parse(JSON.stringify(input, bigintReplacer)) as unknown[];
  const kept: unknown[] = [];
  let bytes = 2; // for "[]"
  let truncated = false;
  for (const row of normalized) {
    const add = Buffer.byteLength(JSON.stringify(row)) + 1; // + separator
    if (kept.length > 0 && bytes + add > maxBytes) {
      truncated = true;
      break;
    }
    kept.push(row);
    bytes += add;
  }
  return { rows: kept, truncated };
}

export interface RunSqlResult {
  rows: unknown[];
  rowCount: number;
  truncated: boolean;
  cached: boolean;
  cachedAt: string | null;
  sqlExecuted: string;
}

interface CacheEntry {
  rows: unknown[];
  rowCount: number;
  truncated: boolean;
  cachedAt: string;
}

class LruCache {
  private readonly map = new Map<string, CacheEntry>();
  constructor(private readonly max: number) {}

  get(key: string): CacheEntry | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: CacheEntry): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

export interface SqlRunnerOptions {
  connectionString?: string | undefined;
  pool?: Pool | undefined;
  statementTimeoutMs?: number | undefined;
  rowLimit?: number | undefined;
  maxBytes?: number | undefined;
  cacheMax?: number | undefined;
}

export class SqlRunner {
  private readonly connectionString: string | undefined;
  private readonly injectedPool: Pool | undefined;
  private readonly statementTimeoutMs: number;
  private readonly rowLimit: number;
  private readonly maxBytes: number;
  private readonly cache: LruCache;
  private builtPool: Pool | undefined;

  constructor(opts: SqlRunnerOptions = {}) {
    this.connectionString = opts.connectionString ?? process.env.DATABASE_URL_RO;
    this.injectedPool = opts.pool;
    this.statementTimeoutMs = opts.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
    this.rowLimit = opts.rowLimit ?? ROW_LIMIT;
    this.maxBytes = opts.maxBytes ?? MAX_BYTES;
    this.cache = new LruCache(opts.cacheMax ?? CACHE_MAX);
  }

  get configured(): boolean {
    return Boolean(this.injectedPool ?? this.connectionString);
  }

  private pool(): Pool {
    if (this.injectedPool) return this.injectedPool;
    if (!this.builtPool) {
      if (!this.connectionString) throw new NotConfiguredError();
      this.builtPool = new Pool({
        connectionString: this.connectionString,
        max: 2,
        statement_timeout: this.statementTimeoutMs,
        // Belt-and-suspenders: read-only session even if the role were misconfigured.
        options: '-c default_transaction_read_only=on',
      });
    }
    return this.builtPool;
  }

  private async latestSweepVersion(): Promise<string> {
    const res = await this.pool().query(VERSION_SQL);
    const v: unknown = res.rows[0]?.v;
    if (v instanceof Date) return v.toISOString();
    return v == null ? 'none' : String(v);
  }

  async run(sql: string): Promise<RunSqlResult> {
    if (!this.configured) throw new NotConfiguredError();

    const v = validateSql(sql, this.rowLimit);
    if (!v.ok) throw new SqlValidationError(v.reason);

    const version = await this.latestSweepVersion();
    const key = `${createHash('sha256').update(v.wrapped).digest('hex')}:${version}`;

    const hit = this.cache.get(key);
    if (hit) {
      return {
        rows: hit.rows,
        rowCount: hit.rowCount,
        truncated: hit.truncated,
        cached: true,
        cachedAt: hit.cachedAt,
        sqlExecuted: v.wrapped,
      };
    }

    const result = await this.pool().query(v.wrapped);
    const { rows, truncated } = serializeRows(result.rows, this.maxBytes);
    const rowCapHit = result.rows.length >= this.rowLimit;
    const entry: CacheEntry = {
      rows,
      rowCount: rows.length,
      truncated: truncated || rowCapHit,
      cachedAt: new Date().toISOString(),
    };
    this.cache.set(key, entry);

    return {
      rows: entry.rows,
      rowCount: entry.rowCount,
      truncated: entry.truncated,
      cached: false,
      cachedAt: null,
      sqlExecuted: v.wrapped,
    };
  }

  async close(): Promise<void> {
    // Never end an injected pool — the caller owns its lifecycle.
    if (this.builtPool) {
      await this.builtPool.end();
      this.builtPool = undefined;
    }
  }
}

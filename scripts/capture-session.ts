// scripts/capture-session.ts
//
// Drives a Firefox browser through 999.md to capture the live SearchAds and
// GetAdvert GraphQL POSTs, then writes them back into the repo:
//
//   src/graphql.ts                                     ← updated query bodies
//   src/__tests__/fixtures/search-ads-response.json    ← refreshed (5 ads)
//   src/__tests__/fixtures/advert-detail-response.json ← refreshed (full)
//   docs/captured-headers.md                           ← header capture log
//   .env.local                                         ← BOOTSTRAP_COOKIES
//
// Usage:
//   pnpm capture-session              # headed Firefox (default)
//   pnpm capture-session --headless   # headless (skip if Cloudflare challenges)
//   pnpm capture-session --timeout 60000
//
// All-or-nothing: if either GraphQL POST is missed, exit non-zero with no writes.
// Variable-shape drift is reported but never auto-fixed.

import { spawnSync } from 'node:child_process';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from 'playwright';

import { POLITENESS } from '../src/config.js';
import { buildAdvertVariables, buildSearchVariables, GET_ADVERT_QUERY } from '../src/graphql.js';
import {
  diffVariables,
  formatCookieEnv,
  headersMarkdownTable,
  looksLikeTaxonomyOpName,
  parseArgs,
  replaceQueryBody,
  trimSearchAdsResponse,
} from './lib/capture-utils.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HOMEPAGE_URL = 'https://999.md/';
const LISTINGS_URL = 'https://999.md/ro/list/real-estate/house-and-garden';
const GRAPHQL_URL = 'https://999.md/graphql';
const LISTING_LINK_SELECTOR = 'a[href^="/ro/"]';
const FIXTURE_AD_LIMIT = 5;

interface CapturedOp {
  query: string;
  variables: Record<string, unknown>;
  // Headers from the live POST. Undefined when populated via a direct API
  // probe (no browser request to introspect).
  requestHeaders: Record<string, string> | undefined;
  body: unknown;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Lazy import keeps the test suite running even when playwright is not
  // installed (it's a script-only devDep).
  const { firefox } = await import('playwright');

  console.error(`Launching Firefox (${args.headless ? 'headless' : 'headed'})…`);
  const browser = await firefox.launch({ headless: args.headless });
  const context = await browser.newContext({
    userAgent: POLITENESS.userAgent,
    viewport: { width: 1280, height: 900 },
    locale: 'ro-RO',
  });
  const page = await context.newPage();

  const captures: { search?: CapturedOp; advert?: CapturedOp; taxonomy?: CapturedOp } = {};
  // operationName → number of POSTs observed. Surfaced at end of capture so we
  // can identify the filter taxonomy op even when our heuristics miss.
  const operationLog = new Map<string, number>();
  // Intercept GraphQL POSTs so we can read the response body before the page
  // consumes it (Firefox loses the body otherwise — NS_ERROR_FAILURE on
  // response.json() if read after dispatch).
  await context.route(GRAPHQL_URL, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') {
      await route.fallback();
      return;
    }
    const postData = req.postData();
    const parsed = parsePostData(postData);
    const op = parsed?.operationName;
    if (op) operationLog.set(op, (operationLog.get(op) ?? 0) + 1);
    const fetched = await route.fetch();
    if (op && parsed && parsed.query && parsed.variables) {
      const body = (await fetched.json().catch(() => null)) as unknown;
      if (body !== null) {
        const captured: CapturedOp = {
          query: parsed.query,
          variables: parsed.variables,
          requestHeaders: req.headers(),
          body,
        };
        if (op === 'SearchAds' && !captures.search) {
          captures.search = captured;
          console.error(`  ✓ captured SearchAds (${parsed.query.length} chars)`);
        } else if (op === 'GetAdvert' && !captures.advert) {
          captures.advert = captured;
          console.error(`  ✓ captured GetAdvert (${parsed.query.length} chars)`);
        } else if (
          !captures.taxonomy &&
          (args.taxonomyOp ? op === args.taxonomyOp : looksLikeTaxonomyOpName(op))
        ) {
          captures.taxonomy = captured;
          console.error(`  ✓ captured ${op} as taxonomy (${parsed.query.length} chars)`);
        }
      }
    }
    await route.fulfill({ response: fetched });
  });
  page.on('requestfailed', (req) => {
    if (req.url().startsWith(GRAPHQL_URL)) {
      console.error(`  graphql request failed: ${req.failure()?.errorText ?? 'unknown'}`);
    }
  });

  let captureError: unknown = null;
  let cookies: { name: string; value: string }[] = [];
  try {
    console.error(`→ ${HOMEPAGE_URL}`);
    await page.goto(HOMEPAGE_URL, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });

    console.error(`→ ${LISTINGS_URL}`);
    await page.goto(LISTINGS_URL, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });

    await waitFor(() => captures.search != null, args.timeoutMs, 'SearchAds POST');

    const listingId = await openFirstListing(page, args.timeoutMs);

    // 999.md SSRs listing detail pages — GetAdvert is no longer fired by the
    // browser. Wait briefly in case that changes, then fall back to a direct
    // API POST using the existing GET_ADVERT_QUERY string.
    try {
      await waitFor(() => captures.advert != null, 5_000, 'GetAdvert POST');
    } catch {
      console.error('  GetAdvert not observed client-side — probing GraphQL endpoint directly');
      await probeGetAdvert(page, listingId, captures);
    }

    // Snapshot cookies while the browser is still alive.
    cookies = (await context.cookies()).map((c) => ({ name: c.name, value: c.value }));
  } catch (err) {
    captureError = err;
  } finally {
    await browser.close();
  }

  if (captureError) {
    printOperationLog(operationLog);
    throw captureError;
  }
  if (!captures.search || !captures.advert) {
    printOperationLog(operationLog);
    console.error('\n✗ Capture incomplete — aborting without writing files.');
    console.error(`  SearchAds: ${captures.search ? 'captured' : 'MISSING'}`);
    console.error(`  GetAdvert: ${captures.advert ? 'captured' : 'MISSING'}`);
    process.exit(1);
  }

  const search = captures.search;
  const advert = captures.advert;
  const taxonomy = captures.taxonomy;

  await writeArtefacts(search, advert, taxonomy, cookies);
  printOperationLog(operationLog);
  if (!taxonomy) {
    console.error(
      '\n⚠ Taxonomy not auto-captured. Pick the right operation name from the log above\n' +
        '  and re-run with `pnpm capture-session --taxonomy-op=<Name>` to add it.\n' +
        '  search + advert artefacts were still written.',
    );
    console.error('\n✓ Partial capture done. Review `git diff` and re-run `pnpm test`.');
    return;
  }
  console.error('\n✓ Done. Review `git diff` and re-run `pnpm test`.');
}

function printOperationLog(log: Map<string, number>): void {
  if (log.size === 0) return;
  console.error('\n── observed GraphQL operations ──');
  const rows = [...log.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [op, count] of rows) {
    const tag = looksLikeTaxonomyOpName(op) ? '  (taxonomy?)' : '';
    console.error(`  ${op} × ${count}${tag}`);
  }
}

async function openFirstListing(page: Page, timeoutMs: number): Promise<string> {
  await page.waitForSelector(LISTING_LINK_SELECTOR, { timeout: timeoutMs });
  const links = await page.locator(LISTING_LINK_SELECTOR).all();
  let id: string | null = null;
  for (const link of links) {
    const href = await link.getAttribute('href');
    const match = href?.match(/^\/ro\/(\d+)/);
    if (match) {
      id = match[1] ?? null;
      break;
    }
  }
  if (!id) throw new Error('No listing link matched on the index page');
  const target = `/ro/${id}`;
  console.error(`→ first listing https://999.md${target}`);
  await page.goto(`https://999.md${target}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  return id;
}

function parsePostData(
  postData: string | null,
): { operationName?: string; query?: string; variables?: Record<string, unknown> } | null {
  if (!postData) return null;
  try {
    return JSON.parse(postData) as ReturnType<typeof parsePostData>;
  } catch {
    return null;
  }
}

async function probeGetAdvert(
  page: Page,
  listingId: string,
  captures: { search?: CapturedOp; advert?: CapturedOp },
): Promise<void> {
  const variables = buildAdvertVariables(listingId);

  // First try the existing query as-is. If it validates we're done.
  const direct = await postGraphQL(page, 'GetAdvert', GET_ADVERT_QUERY, variables);
  if (direct.kind === 'data') {
    captures.advert = {
      query: GET_ADVERT_QUERY,
      variables,
      requestHeaders: undefined,
      body: direct.body,
    };
    console.error(`  ✓ probed GetAdvert via API (id=${listingId})`);
    return;
  }
  if (direct.kind === 'errors') {
    console.error('  GetAdvert query rejected by schema — running introspection to rebuild it');
  } else {
    console.error(`  probe failed: ${direct.message}`);
    return;
  }

  // Discover the real Advert field set via introspection and construct a
  // minimal query from scalar/enum fields plus a couple of obvious wrappers.
  const built = await buildAdvertQueryViaIntrospection(page);
  if (!built) return;

  const retry = await postGraphQL(page, 'GetAdvert', built, variables);
  if (retry.kind !== 'data') {
    console.error(
      `  rebuilt GetAdvert query also failed: ${
        retry.kind === 'errors' ? JSON.stringify(retry.errors).slice(0, 600) : retry.message
      }`,
    );
    return;
  }
  captures.advert = {
    query: built,
    variables,
    requestHeaders: undefined,
    body: retry.body,
  };
  console.error(`  ✓ rebuilt GetAdvert via introspection (id=${listingId})`);
}

type ProbeResult =
  | { kind: 'data'; body: unknown }
  | { kind: 'errors'; errors: unknown }
  | { kind: 'fail'; message: string };

async function postGraphQL(
  page: Page,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<ProbeResult> {
  const resp = await page.request.post(GRAPHQL_URL, {
    data: { operationName, query, variables },
    headers: { 'content-type': 'application/json' },
  });
  if (!resp.ok()) {
    const text = await resp.text().catch(() => '');
    // 400 with `errors` array is a GraphQL validation failure — surface that.
    try {
      const parsed = JSON.parse(text) as { errors?: unknown; data?: unknown };
      if (parsed.errors) return { kind: 'errors', errors: parsed.errors };
    } catch {
      /* not JSON */
    }
    return { kind: 'fail', message: `${resp.status()} ${text.slice(0, 300)}` };
  }
  const body = (await resp.json().catch(() => null)) as { data?: unknown; errors?: unknown } | null;
  if (!body) return { kind: 'fail', message: 'empty response' };
  if (body.errors) return { kind: 'errors', errors: body.errors };
  if (!body.data) return { kind: 'fail', message: 'no data field' };
  return { kind: 'data', body };
}

interface IntrospectField {
  name: string;
  type: IntrospectTypeRef;
  args: { name: string; type: IntrospectTypeRef }[];
}

interface IntrospectTypeRef {
  kind: string;
  name: string | null;
  ofType: IntrospectTypeRef | null;
}

const ADVERT_INTROSPECTION_QUERY = `query AdvertIntrospect {
  __type(name: "Advert") {
    fields {
      name
      type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
      args {
        name
        type { kind name ofType { kind name } }
      }
    }
  }
}`;

async function buildAdvertQueryViaIntrospection(page: Page): Promise<string | null> {
  const resp = await page.request.post(GRAPHQL_URL, {
    data: { operationName: 'AdvertIntrospect', query: ADVERT_INTROSPECTION_QUERY, variables: {} },
    headers: { 'content-type': 'application/json' },
  });
  if (!resp.ok()) {
    console.error(`  introspection failed: ${resp.status()}`);
    return null;
  }
  const body = (await resp.json().catch(() => null)) as {
    data?: { __type?: { fields?: IntrospectField[] | null } | null };
  } | null;
  const fields = body?.data?.__type?.fields;
  if (!fields?.length) {
    console.error('  introspection returned no fields for Advert');
    return null;
  }

  // Pick scalar/enum fields directly; for OBJECT/UNION/INTERFACE fields just
  // request __typename (good enough to fixture-match against the existing
  // parser shape, which only reads scalars off the top-level Advert). Skip
  // any field with a required argument — providing those would need
  // per-field hardcoding, and they're peripheral (analytics/booster fields).
  const selections: string[] = [];
  let skipped = 0;
  for (const f of fields) {
    const hasRequiredArg = f.args.some((a) => a.type.kind === 'NON_NULL');
    if (hasRequiredArg) {
      skipped += 1;
      continue;
    }
    const leaf = unwrapType(f.type);
    if (leaf.kind === 'SCALAR' || leaf.kind === 'ENUM') {
      selections.push(f.name);
    } else if (leaf.kind === 'OBJECT' || leaf.kind === 'INTERFACE' || leaf.kind === 'UNION') {
      selections.push(`${f.name} { __typename }`);
    }
  }
  if (!selections.includes('id')) selections.unshift('id');
  console.error(
    `  introspected Advert: ${fields.length} fields → ${selections.length} selected (${skipped} skipped: required args)`,
  );
  return `query GetAdvert($input: AdvertInput!) {\n  advert(input: $input) {\n    ${selections.join('\n    ')}\n  }\n}`;
}

function unwrapType(t: IntrospectTypeRef): IntrospectTypeRef {
  let current = t;
  while (current.ofType) current = current.ofType;
  return current;
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function writeArtefacts(
  search: CapturedOp,
  advert: CapturedOp,
  taxonomy: CapturedOp | undefined,
  cookies: readonly { name: string; value: string }[],
): Promise<void> {
  const ts = new Date().toISOString();

  const graphqlPath = join(REPO_ROOT, 'src/graphql.ts');
  const original = await readFile(graphqlPath, 'utf8');
  await copyFile(graphqlPath, `${graphqlPath}.bak`);
  let updated = replaceQueryBody(original, 'SEARCH_ADS_QUERY', search.query, ts);
  updated = replaceQueryBody(updated, 'GET_ADVERT_QUERY', advert.query, ts);
  if (taxonomy) {
    updated = replaceQueryBody(updated, 'FILTER_TAXONOMY_QUERY', taxonomy.query, ts);
  }
  await writeFile(graphqlPath, updated, 'utf8');
  console.error('· wrote src/graphql.ts');

  // Validate by typechecking. Roll back on failure.
  const tc = spawnSync('pnpm', ['typecheck'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (tc.status !== 0) {
    await copyFile(`${graphqlPath}.bak`, graphqlPath);
    throw new Error('typecheck failed after writing src/graphql.ts — restored from backup');
  }

  await writeFile(
    join(REPO_ROOT, 'src/__tests__/fixtures/search-ads-response.json'),
    `${JSON.stringify(trimSearchAdsResponse(search.body, FIXTURE_AD_LIMIT), null, 2)}\n`,
    'utf8',
  );
  console.error(`· wrote search-ads-response.json (${FIXTURE_AD_LIMIT} ads)`);

  await writeFile(
    join(REPO_ROOT, 'src/__tests__/fixtures/advert-detail-response.json'),
    `${JSON.stringify(advert.body, null, 2)}\n`,
    'utf8',
  );
  console.error('· wrote advert-detail-response.json');

  if (taxonomy) {
    await writeFile(
      join(REPO_ROOT, 'src/__tests__/fixtures/filter-taxonomy-response.json'),
      `${JSON.stringify(taxonomy.body, null, 2)}\n`,
      'utf8',
    );
    console.error('· wrote filter-taxonomy-response.json');
  }

  const searchDiff = diffVariables(search.variables, buildSearchVariables(0));
  const advertDiff = diffVariables(
    advert.variables,
    buildAdvertVariables(extractAdvertId(advert.variables)),
  );
  if (!searchDiff.ok) {
    console.error(
      '\n⚠ SearchAds variables drift (review src/graphql.ts builders or src/config.ts FILTER):',
    );
    for (const m of searchDiff.messages) console.error(`  - ${m}`);
  }
  if (!advertDiff.ok) {
    console.error('\n⚠ GetAdvert variables drift:');
    for (const m of advertDiff.messages) console.error(`  - ${m}`);
  }

  const headers: Record<string, string> = {
    ...(search.requestHeaders ?? {}),
    ...(advert.requestHeaders ?? {}),
  };
  const headerDoc = `# Captured headers\n\n_Generated: ${ts} by scripts/capture-session.ts_\n\nUnion of headers observed on the SearchAds + GetAdvert POSTs. Per-request\nrows (cookie, auth, CSRF) are noise — only static headers are candidates\nfor wiring into POLITENESS.extraHeaders.\n\n${headersMarkdownTable(headers)}\n`;
  await writeFile(join(REPO_ROOT, 'docs/captured-headers.md'), headerDoc, 'utf8');
  console.error('· wrote docs/captured-headers.md');

  await writeFile(join(REPO_ROOT, '.env.local'), `${formatCookieEnv(cookies)}\n`, 'utf8');
  console.error('· wrote .env.local (gitignored)');

  const capturedUa = headers['user-agent'];
  if (capturedUa && capturedUa !== POLITENESS.userAgent) {
    console.error(`\n⚠ User-Agent drift — update POLITENESS.userAgent in src/config.ts:`);
    console.error(`  current:  ${POLITENESS.userAgent}`);
    console.error(`  captured: ${capturedUa}`);
  }

  spawnSync('pnpm', ['prettier', '--write', 'src/graphql.ts'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}

function extractAdvertId(variables: Record<string, unknown>): string {
  const input = variables['input'];
  if (input && typeof input === 'object' && 'id' in input) {
    const id = (input as { id: unknown }).id;
    if (typeof id === 'string') return id;
    if (typeof id === 'number') return String(id);
  }
  return '<captured>';
}

main().catch((err: unknown) => {
  console.error('\n✗ capture-session failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

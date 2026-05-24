// scripts/capture-taxonomy.ts
//
// Captures 999.md's filter-taxonomy GraphQL op for a given category listings
// page and writes the response body to a JSON file (same shape as
// src/data/filter-taxonomy.*.json). Used to add per-subcategory taxonomies
// (sub-project D: category-aware filters).
//
// HUMAN-LIKE ONLY: real Firefox + POLITENESS UA + seeded cf cookies — never
// the undici crawler path. See the project rule on 999.md request fidelity.
//
// Usage:
//   pnpm tsx scripts/capture-taxonomy.ts --url https://999.md/ro/list/real-estate/apartments-and-rooms --out src/data/filter-taxonomy.1404.json
//   ... --dwell 120000     # keep Firefox open for manual navigation if the URL is wrong
//   ... --taxonomy-op GetFilters

import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { POLITENESS } from '../src/config.js';
import { looksLikeTaxonomyOpName } from './lib/capture-utils.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOMEPAGE_URL = 'https://999.md/';
const GRAPHQL_URL = 'https://999.md/graphql';

interface Args {
  url: string;
  out: string;
  taxonomyOp: string | null;
  dwellMs: number;
  headless: boolean;
  timeoutMs: number;
}

function parseArgs(argv: readonly string[]): Args {
  const a: Args = {
    url: '',
    out: '',
    taxonomyOp: null,
    dwellMs: 0,
    headless: false,
    timeoutMs: 45_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const f = argv[i];
    if (f === '--url') a.url = argv[++i] ?? '';
    else if (f === '--out') a.out = argv[++i] ?? '';
    else if (f === '--taxonomy-op') a.taxonomyOp = argv[++i] ?? null;
    else if (f === '--dwell') a.dwellMs = Number(argv[++i]);
    else if (f === '--headless') a.headless = true;
    else if (f === '--timeout') a.timeoutMs = Number(argv[++i]);
    else throw new Error(`Unknown flag: ${String(f)}`);
  }
  if (!a.url || !a.out) throw new Error('--url and --out are required');
  return a;
}

function parseBootstrapCookies(): { name: string; value: string; domain: string; path: string }[] {
  const raw = process.env.BOOTSTRAP_COOKIES;
  if (!raw) return [];
  return raw
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const eq = p.indexOf('=');
      return { name: p.slice(0, eq), value: p.slice(eq + 1), domain: '.999.md', path: '/' };
    })
    .filter((c) => c.name);
}

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('timed out');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { firefox } = await import('playwright');

  console.error(`Launching Firefox (${args.headless ? 'headless' : 'headed'})…`);
  const browser = await firefox.launch({ headless: args.headless });
  const context = await browser.newContext({
    userAgent: POLITENESS.userAgent,
    viewport: { width: 1366, height: 1000 },
    locale: 'ro-RO',
  });
  const cookies = parseBootstrapCookies();
  if (cookies.length) {
    await context.addCookies(cookies);
    console.error(`  seeded ${cookies.length} bootstrap cookies`);
  }
  const page = await context.newPage();

  let taxonomyBody: unknown = null;
  const seenOps = new Map<string, number>();

  await context.route(GRAPHQL_URL, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    let parsed: { operationName?: string } | null = null;
    try {
      parsed = JSON.parse(req.postData() ?? 'null');
    } catch {
      parsed = null;
    }
    const op = parsed?.operationName;
    if (op) seenOps.set(op, (seenOps.get(op) ?? 0) + 1);
    try {
      const fetched = await route.fetch();
      const isTaxonomy =
        op && (args.taxonomyOp ? op === args.taxonomyOp : looksLikeTaxonomyOpName(op));
      if (isTaxonomy && taxonomyBody === null) {
        const body = (await fetched.json().catch(() => null)) as unknown;
        if (body && typeof body === 'object' && 'data' in body) {
          taxonomyBody = body;
          console.error(`  ✓ captured taxonomy op "${op}"`);
        }
      }
      await route.fulfill({ response: fetched });
    } catch {
      // Context can dispose mid-flight once we close the browser; a
      // disposed-route error must not crash the process before we write.
    }
  });

  try {
    console.error(`→ ${HOMEPAGE_URL}`);
    await page.goto(HOMEPAGE_URL, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });
    console.error(`→ ${args.url}`);
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });
    await waitFor(() => taxonomyBody !== null, args.timeoutMs).catch(() =>
      console.error('  ⚠ taxonomy op not seen on initial load'),
    );
    if (taxonomyBody === null && args.dwellMs > 0) {
      console.error(
        `\n── MANUAL-ASSIST: Firefox open ${Math.round(args.dwellMs / 1000)}s.\n` +
          '   Navigate to the right category listings page; the taxonomy op is captured.\n',
      );
      await page.waitForTimeout(args.dwellMs);
    }
  } catch (err) {
    console.error(`\n✗ ${(err as Error).message}`);
  } finally {
    await browser.close();
  }

  if (seenOps.size > 0) {
    console.error('── observed ops ──');
    for (const [op, n] of [...seenOps.entries()].sort((a, b) => b[1] - a[1])) {
      console.error(`  ${op} × ${n}${looksLikeTaxonomyOpName(op) ? '  (taxonomy?)' : ''}`);
    }
  }

  if (taxonomyBody === null) {
    console.error('\n✗ No taxonomy captured — nothing written.');
    process.exit(1);
  }

  const outPath = join(REPO_ROOT, args.out);
  await writeFile(outPath, `${JSON.stringify(taxonomyBody, null, 2)}\n`, 'utf8');

  // Sanity log: filter titles so the operator can confirm the category.
  const filters =
    (
      taxonomyBody as {
        data?: { category?: { filters?: Array<{ title?: { translated?: string } }> } };
      }
    ).data?.category?.filters ?? [];
  console.error(`\n✓ wrote ${args.out} (${filters.length} filter dimensions)`);
  console.error('  ' + filters.map((f) => f.title?.translated ?? '?').join(', '));
}

await main();

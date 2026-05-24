// scripts/capture-filter-serialization.ts
//
// Sub-project A discovery spike (see
// docs/superpowers/specs/2026-05-24-capture-range-boolean-serialization-design.md).
//
// Drives a real Firefox session through 999.md's listings filter sidebar,
// applies a RANGE-int (rooms), a RANGE-unit (total area) and a FEATURES_AND
// boolean (amenity) filter, and captures every SearchAds GraphQL POST so we
// can see how 999.md serializes those filter types into Ads_SearchInput.
//
// This is a DISCOVERY tool, not the all-or-nothing capture-session: it logs
// richly, never throws on a missed selector, dumps the sidebar DOM for offline
// analysis, and offers a manual-assist dwell window. Writes findings to
// docs/captured-filter-serialization.md + trimmed fixtures.
//
// Usage:
//   pnpm tsx scripts/capture-filter-serialization.ts                 # headed
//   pnpm tsx scripts/capture-filter-serialization.ts --dwell 120000  # manual-assist
//   pnpm tsx scripts/capture-filter-serialization.ts --headless

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from 'playwright';

import { POLITENESS } from '../src/config.js';
import { diffVariables, trimSearchAdsResponse } from './lib/capture-utils.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOMEPAGE_URL = 'https://999.md/';
const LISTINGS_URL = 'https://999.md/ro/list/real-estate/house-and-garden';
const GRAPHQL_URL = 'https://999.md/graphql';

interface SearchCapture {
  label: string;
  pageUrl: string;
  input: unknown;
  body: unknown;
}

interface Args {
  headless: boolean;
  dwellMs: number;
  timeoutMs: number;
}

function parseArgs(argv: readonly string[]): Args {
  const a: Args = { headless: false, dwellMs: 0, timeoutMs: 45_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const f = argv[i];
    if (f === '--headless') a.headless = true;
    else if (f === '--dwell') {
      a.dwellMs = Number(argv[++i]);
      if (!Number.isFinite(a.dwellMs)) throw new Error('--dwell needs ms');
    } else if (f === '--timeout') {
      a.timeoutMs = Number(argv[++i]);
      if (!Number.isFinite(a.timeoutMs)) throw new Error('--timeout needs ms');
    } else throw new Error(`Unknown flag: ${String(f)}`);
  }
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
      return {
        name: p.slice(0, eq),
        value: p.slice(eq + 1),
        domain: '.999.md',
        path: '/',
      };
    })
    .filter((c) => c.name);
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
  const captures: SearchCapture[] = [];
  let pendingLabel = 'baseline';

  await context.route(GRAPHQL_URL, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    let parsed: { operationName?: string; variables?: { input?: unknown } } | null = null;
    try {
      parsed = JSON.parse(req.postData() ?? 'null');
    } catch {
      parsed = null;
    }
    const fetched = await route.fetch();
    if (parsed?.operationName === 'SearchAds') {
      const body = (await fetched.json().catch(() => null)) as unknown;
      captures.push({
        label: pendingLabel,
        pageUrl: page.url(),
        input: parsed.variables?.input ?? null,
        body,
      });
      console.error(`  ✓ SearchAds captured [${pendingLabel}] (#${captures.length})`);
    }
    await route.fulfill({ response: fetched });
  });

  try {
    console.error(`→ ${HOMEPAGE_URL}`);
    await page.goto(HOMEPAGE_URL, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });
    console.error(`→ ${LISTINGS_URL}`);
    await page.goto(LISTINGS_URL, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });
    await waitForCount(() => captures.length, 1, args.timeoutMs, 'baseline SearchAds');

    await dismissTour(page);
    await dumpSidebar(page);

    // 999.md auto-applies the sidebar (the result count re-queries live), so
    // each filter change fires a SearchAds. Label before each apply so captures
    // attribute to the right filter.
    pendingLabel = 'range-rooms';
    await applyRange(page, ['Număr de camere', 'Number of rooms'], '2', '4');
    pendingLabel = 'range-area';
    await applyRange(page, ['Suprafață totală', 'Suprafata totala', 'Total area'], '50', '200');
    pendingLabel = 'boolean-amenity';
    await applyBoolean(page, ['Adăugător', 'Additional'], ['Gata de mutat', 'Ready to move']);
    await page.waitForTimeout(2_500); // let the final re-query land

    if (args.dwellMs > 0) {
      pendingLabel = 'manual';
      console.error(
        `\n── MANUAL-ASSIST: browser open for ${Math.round(args.dwellMs / 1000)}s.\n` +
          '   Apply any filters by hand in the sidebar; every SearchAds is captured.\n',
      );
      await page.waitForTimeout(args.dwellMs);
    }
  } catch (err) {
    console.error(`\n✗ capture error: ${(err as Error).message}`);
  } finally {
    await browser.close();
  }

  await writeFindings(captures);
}

// Each 999.md filter is a <details> whose <summary> holds the title. RANGE
// filters have no numeric id (only OPTIONS do), so locate by title text. The
// body holds two inputs prefixed "de la" (from) / "pînă la" (to).
async function applyRange(page: Page, titles: string[], min: string, max: string): Promise<void> {
  for (const title of titles) {
    const details = page
      .locator('details')
      .filter({ has: page.getByText(title, { exact: false }) })
      .first();
    if ((await details.count()) === 0) continue;
    try {
      await details.scrollIntoViewIfNeeded({ timeout: 5_000 });
      if ((await details.getAttribute('open')) === null) {
        await details
          .locator('summary')
          .first()
          .click({ timeout: 5_000 })
          .catch(() => {});
      }
      const inputs = details.locator('input');
      const n = await inputs.count();
      console.error(`  range "${title}": ${n} input(s)`);
      if (n >= 2) {
        await inputs.nth(0).fill(min, { timeout: 5_000 });
        await inputs.nth(1).fill(max, { timeout: 5_000 });
        await inputs
          .nth(1)
          .blur()
          .catch(() => {});
        console.error(`  range "${title}": set ${min}–${max}`);
        return;
      }
    } catch (e) {
      console.error(`  range "${title}" failed: ${(e as Error).message}`);
    }
  }
  console.error(`  ⚠ range not applied for: ${titles.join(' / ')}`);
}

// FEATURES_AND amenities live in a <details> (e.g. "Adăugător") with no
// numeric id; each option is a hidden <input type=checkbox> whose clickable
// target is the enclosing styles_radio__ wrapper. Expand the section first.
async function applyBoolean(
  page: Page,
  sectionTitles: string[],
  optionLabels: string[],
): Promise<void> {
  for (const section of sectionTitles) {
    const det = page
      .locator('details')
      .filter({ has: page.getByText(section, { exact: false }) })
      .first();
    if ((await det.count()) === 0) continue;
    await det.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
    if ((await det.getAttribute('open')) === null) {
      await det
        .locator('summary')
        .first()
        .click({ timeout: 5_000 })
        .catch(() => {});
    }
    for (const label of optionLabels) {
      const lbl = det.getByText(label, { exact: false }).first();
      if ((await lbl.count()) === 0) continue;
      const wrapper = lbl.locator('xpath=ancestor::*[contains(@class,"styles_radio__")][1]');
      const target = (await wrapper.count()) > 0 ? wrapper.first() : lbl;
      try {
        await target.scrollIntoViewIfNeeded({ timeout: 5_000 });
        await target.click({ timeout: 5_000 });
        console.error(`  boolean "${section} → ${label}": clicked`);
        return;
      } catch (e) {
        console.error(`  boolean "${label}" failed: ${(e as Error).message}`);
      }
    }
  }
  console.error(`  ⚠ boolean not applied for: ${sectionTitles.join(' / ')}`);
}

// 999.md fires a one-time intro.js product tour whose overlay intercepts
// pointer events. Dismiss it (skip button) and hard-remove any residual nodes.
async function dismissTour(page: Page): Promise<void> {
  const skip = page.locator('.introjs-skipbutton, .introjs-donebutton').first();
  if ((await skip.count()) > 0) {
    await skip.click({ timeout: 3_000 }).catch(() => {});
    console.error('  dismissed intro.js tour');
  }
  await page
    .evaluate(() => {
      // Browser context; type document structurally to avoid pulling in the
      // DOM lib (this script compiles under a Node-only tsconfig).
      const g = globalThis as unknown as {
        document?: {
          querySelectorAll(s: string): { forEach(cb: (e: { remove(): void }) => void): void };
        };
      };
      g.document
        ?.querySelectorAll(
          '.introjs-overlay, .introjs-tour, .introjs-helperLayer, .introjs-tooltipReferenceLayer, .introjs-disableInteraction',
        )
        .forEach((e) => e.remove());
    })
    .catch(() => {});
}

async function dumpSidebar(page: Page): Promise<void> {
  try {
    const html = await page.content();
    const dir = join(REPO_ROOT, 'data');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'filter-sidebar-dump.html'), html, 'utf8');
    console.error(`  ✓ dumped page HTML → data/filter-sidebar-dump.html (${html.length} bytes)`);
  } catch (e) {
    console.error(`  ⚠ sidebar dump failed: ${(e as Error).message}`);
  }
}

async function waitForCount(
  get: () => number,
  target: number,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (get() >= target) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function writeFindings(captures: SearchCapture[]): Promise<void> {
  if (captures.length === 0) {
    console.error('\n✗ No SearchAds captured — nothing to write.');
    return;
  }
  const baseline = captures[0]!;
  const lines: string[] = [];
  lines.push('# Captured 999.md filter serialization (RANGE + BOOLEAN)');
  lines.push('');
  lines.push(`Captured ${new Date().toISOString()} from a real Firefox session.`);
  lines.push(`Total SearchAds requests observed: ${captures.length}.`);
  lines.push('');
  lines.push('## Baseline (unfiltered) input');
  lines.push('```json');
  lines.push(JSON.stringify(baseline.input, null, 2));
  lines.push('```');
  lines.push('');

  const fixturesDir = join(REPO_ROOT, 'src/__tests__/fixtures');
  await mkdir(fixturesDir, { recursive: true });

  for (let i = 1; i < captures.length; i += 1) {
    const cap = captures[i]!;
    const diff = diffVariables(cap.input, baseline.input);
    lines.push(`## ${cap.label} (request #${i + 1})`);
    lines.push(`Page URL: \`${cap.pageUrl}\``);
    lines.push('');
    lines.push('Diff vs baseline `input` (captured = filtered, expected = baseline):');
    lines.push('```');
    lines.push(
      diff.ok
        ? '(no structural difference — filter likely rode the URL only)'
        : diff.messages.join('\n'),
    );
    lines.push('```');
    lines.push('');
    lines.push('Full filtered `input`:');
    lines.push('```json');
    lines.push(JSON.stringify(cap.input, null, 2));
    lines.push('```');
    lines.push('');

    // Trim + persist the response body as a fixture for sub-project B.
    try {
      const trimmed = trimSearchAdsResponse(cap.body, 3);
      const fx = join(fixturesDir, `search-ads-${cap.label}.json`);
      await writeFile(fx, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
      console.error(`  ✓ fixture → ${fx}`);
    } catch (e) {
      console.error(`  ⚠ fixture skipped for ${cap.label}: ${(e as Error).message}`);
    }
  }

  const docPath = join(REPO_ROOT, 'docs/captured-filter-serialization.md');
  await writeFile(docPath, `${lines.join('\n')}\n`, 'utf8');
  console.error(`\n✓ findings → ${docPath}`);
}

await main();

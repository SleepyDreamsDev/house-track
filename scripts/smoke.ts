// scripts/smoke.ts
//
// One-shot live smoke: spawns `RUN_ONCE=1 node dist/index.js`, then asserts
// the sweep produced sane DB state. Replaces "spot-check Prisma Studio".
//
// Usage:
//   pnpm build && LIVE_SMOKE=1 pnpm smoke
//
// Hits the live site exactly once. Without LIVE_SMOKE=1 it refuses, so an
// accidental invocation in CI is a no-op.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ENTRY = join(REPO_ROOT, 'dist/index.js');

const MIN_NEW_OR_UPDATED_LISTINGS = 30; // matches backlog "~30 backfill rows per tick"

interface AssertionResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function main(): Promise<void> {
  if (process.env['LIVE_SMOKE'] !== '1') {
    console.error(
      '✗ LIVE_SMOKE=1 not set. This script hits the live 999.md site — guard is required.\n' +
        '  Re-run with: LIVE_SMOKE=1 pnpm smoke',
    );
    process.exit(2);
  }
  if (!existsSync(DIST_ENTRY)) {
    console.error(`✗ ${DIST_ENTRY} not found. Run \`pnpm build\` first.`);
    process.exit(2);
  }

  const sweepStart = new Date();
  console.error(`→ running one sweep (RUN_ONCE=1) at ${sweepStart.toISOString()}`);
  await runOnce();
  console.error(`✓ sweep exited (${((Date.now() - sweepStart.getTime()) / 1000).toFixed(1)}s)`);

  const prisma = new PrismaClient();
  try {
    const since = new Date(sweepStart.getTime() - 60_000); // 1 min cushion
    const results = await runAssertions(prisma, since);
    report(results);
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } finally {
    await prisma.$disconnect();
  }
}

function runOnce(): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn('node', [DIST_ENTRY], {
      cwd: REPO_ROOT,
      env: { ...process.env, RUN_ONCE: '1' },
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) resolveFn();
      else rejectFn(new Error(`crawler exited with code ${code ?? 'null'}`));
    });
    child.on('error', rejectFn);
  });
}

async function runAssertions(prisma: PrismaClient, since: Date): Promise<AssertionResult[]> {
  const out: AssertionResult[] = [];

  const sweep = await prisma.sweepRun.findFirst({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: 'desc' },
  });
  out.push({
    name: 'sweep recorded',
    ok: sweep !== null,
    detail: sweep ? `id=${sweep.id} status=${sweep.status}` : 'no SweepRun row found',
  });
  if (!sweep) return out;

  out.push({
    name: 'sweep status=ok',
    ok: sweep.status === 'ok',
    detail: `actual: ${sweep.status}`,
  });

  out.push({
    name: 'sweep finishedAt populated',
    ok: sweep.finishedAt !== null,
    detail: sweep.finishedAt ? `finishedAt=${sweep.finishedAt.toISOString()}` : 'still null',
  });

  const errors403or429 = countRateLimitErrors(sweep.errors);
  out.push({
    name: 'no 403/429 in errors',
    ok: errors403or429 === 0,
    detail: errors403or429 === 0 ? '0 found' : `${errors403or429} 403/429 entries`,
  });

  const recentlyTouched = await prisma.listing.count({
    where: { lastFetchedAt: { gte: since } },
  });
  out.push({
    name: `≥${MIN_NEW_OR_UPDATED_LISTINGS} listings touched`,
    ok: recentlyTouched >= MIN_NEW_OR_UPDATED_LISTINGS,
    detail: `actual: ${recentlyTouched}`,
  });

  const newFilterValues = await prisma.listingFilterValue.count({
    where: { listing: { lastFetchedAt: { gte: since } } },
  });
  out.push({
    name: '≥1 ListingFilterValue from this sweep',
    ok: newFilterValues >= 1,
    detail: `actual: ${newFilterValues}`,
  });

  const enrichedNewly = await prisma.listing.count({
    where: { filterValuesEnrichedAt: { gte: since } },
  });
  out.push({
    name: '≥1 listing newly enriched (filterValuesEnrichedAt set)',
    ok: enrichedNewly >= 1,
    detail: `actual: ${enrichedNewly}`,
  });

  return out;
}

function countRateLimitErrors(errors: unknown): number {
  if (!Array.isArray(errors)) return 0;
  let n = 0;
  for (const e of errors) {
    if (e && typeof e === 'object') {
      const status = (e as { status?: unknown }).status;
      if (status === 403 || status === 429) n += 1;
      const msg = (e as { msg?: unknown }).msg;
      if (typeof msg === 'string' && /\b(403|429)\b/.test(msg)) n += 1;
    }
  }
  return n;
}

function report(results: AssertionResult[]): void {
  console.error('\n── smoke assertions ───────────────────────────────────');
  for (const r of results) {
    const tick = r.ok ? '✓' : '✗';
    console.error(`  ${tick} ${r.name} — ${r.detail}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.error(`──────────────────────────────────────────────────────`);
  console.error(`  ${passed}/${results.length} passed`);
}

main().catch((err: unknown) => {
  console.error(`✗ smoke failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});

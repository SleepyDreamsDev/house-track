// Shared smoke assertion logic. Used by both the CLI smoke (`scripts/smoke.ts`,
// LIVE_SMOKE=1 pnpm smoke) and the operator UI smoke route (POST /api/sweeps/smoke).
//
// Spec: docs/superpowers/specs/2026-05-09-operator-ui-smoke-test-design.md

import type { PrismaClient } from '@prisma/client';

export interface AssertionResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SmokeAssertOpts {
  /** Minimum listings.touched threshold. CLI uses 30, HTTP smoke uses 1. */
  minListingsTouched: number;
}

export async function runSmokeAssertions(
  prisma: PrismaClient,
  since: Date,
  opts: SmokeAssertOpts,
): Promise<AssertionResult[]> {
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
    name: `≥${opts.minListingsTouched} listings touched`,
    ok: recentlyTouched >= opts.minListingsTouched,
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

export function countRateLimitErrors(errors: unknown): number {
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

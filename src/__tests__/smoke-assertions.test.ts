import { beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { getPrisma } from '../db.js';
import { runSmokeAssertions } from '../smoke-assertions.js';

describe('runSmokeAssertions', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = getPrisma();
    await prisma.listingFilterValue.deleteMany();
    await prisma.listing.deleteMany();
    await prisma.sweepRun.deleteMany();
  });

  async function seedHealthySweep(since: Date): Promise<void> {
    await prisma.sweepRun.create({
      data: {
        startedAt: since,
        finishedAt: new Date(),
        status: 'ok',
        errors: [],
        source: '999.md',
        trigger: 'smoke',
      },
    });

    const listing = await prisma.listing.create({
      data: {
        id: 'smoke-1',
        url: 'https://999.md/ro/smoke-1',
        title: 'smoke listing',
        priceRaw: '100 €',
        priceEur: 100,
        firstSeenAt: since,
        lastSeenAt: since,
        lastFetchedAt: new Date(since.getTime() + 1000),
        active: true,
        filterValuesEnrichedAt: new Date(since.getTime() + 2000),
      },
    });

    await prisma.listingFilterValue.create({
      data: {
        listingId: listing.id,
        filterId: 1,
        featureId: 42,
        textValue: 'test',
      },
    });
  }

  it('Scenario: runSmokeAssertions reports all-pass for a healthy sweep', async () => {
    const since = new Date(Date.now() - 60_000);
    await seedHealthySweep(since);

    const results = await runSmokeAssertions(prisma, since, { minListingsTouched: 1 });

    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.name)).toEqual([
      'sweep recorded',
      'sweep status=ok',
      'sweep finishedAt populated',
      'no 403/429 in errors',
      '≥1 listings touched',
      '≥1 ListingFilterValue from this sweep',
      '≥1 listing newly enriched (filterValuesEnrichedAt set)',
    ]);
  });

  it('Scenario: runSmokeAssertions flags a sweep that finished with status=failed', async () => {
    const since = new Date(Date.now() - 60_000);
    await prisma.sweepRun.create({
      data: { startedAt: since, finishedAt: new Date(), status: 'failed', errors: [] },
    });

    const results = await runSmokeAssertions(prisma, since, { minListingsTouched: 1 });
    const statusAssertion = results.find((r) => r.name === 'sweep status=ok');

    expect(statusAssertion?.ok).toBe(false);
    expect(statusAssertion?.detail).toBe('actual: failed');
  });

  it('Scenario: runSmokeAssertions counts 403 errors as rate-limit failures', async () => {
    const since = new Date(Date.now() - 60_000);
    await prisma.sweepRun.create({
      data: {
        startedAt: since,
        finishedAt: new Date(),
        status: 'partial',
        errors: [{ url: 'https://999.md/x', status: 403, msg: 'forbidden' }],
      },
    });

    const results = await runSmokeAssertions(prisma, since, { minListingsTouched: 1 });
    const rateLimit = results.find((r) => r.name === 'no 403/429 in errors');

    expect(rateLimit?.ok).toBe(false);
    expect(rateLimit?.detail).toContain('1');
  });

  it('Scenario: runSmokeAssertions threshold is configurable (high threshold fails)', async () => {
    const since = new Date(Date.now() - 60_000);
    await seedHealthySweep(since);

    const results = await runSmokeAssertions(prisma, since, { minListingsTouched: 30 });
    const touched = results.find((r) => r.name === '≥30 listings touched');

    expect(touched?.ok).toBe(false);
    expect(touched?.detail).toBe('actual: 1');
  });

  it('reports "no SweepRun row found" when no sweep exists in window', async () => {
    const since = new Date(Date.now() - 60_000);

    const results = await runSmokeAssertions(prisma, since, { minListingsTouched: 1 });

    expect(results[0]?.name).toBe('sweep recorded');
    expect(results[0]?.ok).toBe(false);
    expect(results).toHaveLength(1);
  });
});

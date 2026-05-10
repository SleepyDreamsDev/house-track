import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let prisma: PrismaClient;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  prisma = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.throttleEvent.deleteMany();
  await prisma.fetchTask.deleteMany();
  await prisma.listingSnapshot.deleteMany();
  await prisma.listingFilterValue.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.sweepRun.deleteMany();
});

async function seedListing(id: string): Promise<void> {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/ro/${id}`,
      firstSeenAt: now,
      lastSeenAt: now,
      lastFetchedAt: now,
      title: `Title ${id}`,
    },
  });
}

describe('FetchTask queue', () => {
  it('accepts a NEW-priority task and defaults timestamps + attemptCount', async () => {
    await seedListing('L1');
    const before = Date.now();

    const created = await prisma.fetchTask.create({
      data: { listingId: 'L1', priority: 0, reason: 'new' },
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.priority).toBe(0);
    expect(created.reason).toBe('new');
    expect(created.attemptCount).toBe(0);
    expect(created.lastError).toBeNull();
    expect(created.enqueuedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(created.scheduledFor.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('deduplicates by (listingId, reason) — second insert raises a unique-constraint error', async () => {
    await seedListing('L1');
    await prisma.fetchTask.create({
      data: { listingId: 'L1', priority: 0, reason: 'new' },
    });

    await expect(
      prisma.fetchTask.create({
        data: { listingId: 'L1', priority: 0, reason: 'new' },
      }),
    ).rejects.toThrow();

    const count = await prisma.fetchTask.count({ where: { listingId: 'L1' } });
    expect(count).toBe(1);
  });

  it('allows distinct reasons for the same listingId (e.g. new + watchlist)', async () => {
    await seedListing('L1');
    await prisma.fetchTask.create({
      data: { listingId: 'L1', priority: 0, reason: 'new' },
    });
    await prisma.fetchTask.create({
      data: { listingId: 'L1', priority: 1, reason: 'watchlist' },
    });

    const count = await prisma.fetchTask.count({ where: { listingId: 'L1' } });
    expect(count).toBe(2);
  });

  it('orders by priority then scheduledFor when popping the next eligible task', async () => {
    await Promise.all([seedListing('L1'), seedListing('L2'), seedListing('L3')]);
    const now = new Date();
    await prisma.fetchTask.create({
      data: {
        listingId: 'L1',
        priority: 3,
        reason: 'backfill',
        scheduledFor: now,
      },
    });
    await prisma.fetchTask.create({
      data: {
        listingId: 'L2',
        priority: 0,
        reason: 'new',
        scheduledFor: new Date(now.getTime() + 1000),
      },
    });
    await prisma.fetchTask.create({
      data: {
        listingId: 'L3',
        priority: 2,
        reason: 'stale',
        scheduledFor: now,
      },
    });

    const next = await prisma.fetchTask.findMany({
      where: { scheduledFor: { lte: new Date(now.getTime() + 5000) } },
      orderBy: [{ priority: 'asc' }, { scheduledFor: 'asc' }],
    });

    expect(next.map((t) => t.listingId)).toEqual(['L2', 'L3', 'L1']);
  });

  it('respects scheduledFor — future-dated tasks are not eligible', async () => {
    await seedListing('L1');
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.fetchTask.create({
      data: { listingId: 'L1', priority: 0, reason: 'new', scheduledFor: future },
    });

    const eligible = await prisma.fetchTask.findMany({
      where: { scheduledFor: { lte: new Date() } },
    });
    expect(eligible).toEqual([]);
  });
});

describe('ThrottleEvent log', () => {
  it('records a soft-throttle trigger with default triggeredAt', async () => {
    const before = Date.now();
    const created = await prisma.throttleEvent.create({
      data: {
        trigger: '5xx_rate',
        durationMs: 30 * 60 * 1000,
        context: { recent5xx: 4, windowSize: 50 },
      },
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.trigger).toBe('5xx_rate');
    expect(created.durationMs).toBe(30 * 60 * 1000);
    expect(created.context).toEqual({ recent5xx: 4, windowSize: 50 });
    expect(created.triggeredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('allows context to be null', async () => {
    const created = await prisma.throttleEvent.create({
      data: { trigger: 'connection_reset', durationMs: 1800000 },
    });
    expect(created.context).toBeNull();
  });
});

describe('SweepRun.kind column', () => {
  it("defaults to 'legacy' when not specified", async () => {
    const run = await prisma.sweepRun.create({ data: { status: 'ok' } });
    expect(run.kind).toBe('legacy');
  });

  it("stores supplied kind values like 'index' and 'detail'", async () => {
    const indexRun = await prisma.sweepRun.create({
      data: { status: 'ok', kind: 'index' },
    });
    const detailRun = await prisma.sweepRun.create({
      data: { status: 'ok', kind: 'detail' },
    });

    expect(indexRun.kind).toBe('index');
    expect(detailRun.kind).toBe('detail');
  });
});

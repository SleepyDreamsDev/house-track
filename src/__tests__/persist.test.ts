import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Persistence } from '../persist.js';
import type { ListingStub, ParsedDetail } from '../types.js';

const HOUR = 60 * 60 * 1000;

let dir: string;
let prisma: PrismaClient;
let persist: Persistence;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'persist-'));
  const dbPath = join(dir, 'test.db');
  const url = `file:${dbPath}`;
  execSync('pnpm prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  prisma = new PrismaClient({ datasources: { db: { url } } });
  persist = new Persistence(prisma);
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.listingSnapshot.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.sweepRun.deleteMany();
});

const stub = (id: string, overrides: Partial<ListingStub> = {}): ListingStub => ({
  id,
  url: `https://999.md/ro/${id}`,
  title: `Title ${id}`,
  priceEur: 100_000,
  priceRaw: '€100000',
  postedAt: null,
  ...overrides,
});

const detail = (id: string, overrides: Partial<ParsedDetail> = {}): ParsedDetail => ({
  id,
  url: `https://999.md/ro/${id}`,
  title: `Title ${id}`,
  priceEur: 100_000,
  priceRaw: '€100000',
  rooms: 4,
  areaSqm: 120,
  landSqm: 600,
  district: 'Buiucani',
  street: 'Strada Test 1',
  floors: 2,
  yearBuilt: 2010,
  heatingType: 'autonomă',
  description: 'A nice house',
  features: ['garage', 'garden'],
  imageUrls: ['https://cdn.999.md/img1.jpg'],
  sellerType: 'private',
  postedAt: new Date('2026-04-01T00:00:00Z'),
  bumpedAt: null,
  rawHtmlHash: 'abc123',
  ...overrides,
});

async function seedListing(id: string, fields: Partial<{ lastSeenAt: Date; active: boolean }>) {
  const now = new Date();
  await prisma.listing.create({
    data: {
      id,
      url: `https://999.md/ro/${id}`,
      title: `Title ${id}`,
      lastSeenAt: fields.lastSeenAt ?? now,
      lastFetchedAt: now,
      active: fields.active ?? true,
    },
  });
}

describe('Persistence', () => {
  it('Diffing returns ids that are new vs already known', async () => {
    await seedListing('A', {});
    await seedListing('B', {});

    const result = await persist.diffAgainstDb([stub('B'), stub('C')]);

    expect(result.new.map((s) => s.id)).toEqual(['C']);
    expect(result.seen.map((s) => s.id)).toEqual(['B']);
  });

  it('markSeen bumps lastSeenAt on every passed stub', async () => {
    await seedListing('X', { lastSeenAt: new Date(Date.now() - 2 * 24 * HOUR), active: false });

    await persist.markSeen([stub('X')]);

    const row = await prisma.listing.findUniqueOrThrow({ where: { id: 'X' } });
    expect(Date.now() - row.lastSeenAt.getTime()).toBeLessThan(1_000);
    expect(row.active).toBe(true);
  });

  it('markInactiveOlderThan flips listings whose lastSeenAt is older than the cutoff', async () => {
    await seedListing('OLD', { lastSeenAt: new Date(Date.now() - 4 * HOUR) });
    await seedListing('FRESH', { lastSeenAt: new Date(Date.now() - 30 * 60 * 1000) });

    const flipped = await persist.markInactiveOlderThan(3 * HOUR);

    const old = await prisma.listing.findUniqueOrThrow({ where: { id: 'OLD' } });
    const fresh = await prisma.listing.findUniqueOrThrow({ where: { id: 'FRESH' } });
    expect(old.active).toBe(false);
    expect(fresh.active).toBe(true);
    expect(flipped).toBe(1);
  });

  it('persistDetail creates a new Listing on first sight, with one snapshot', async () => {
    await persist.persistDetail(detail('NEW'));

    const row = await prisma.listing.findUniqueOrThrow({ where: { id: 'NEW' } });
    expect(row.title).toBe('Title NEW');
    expect(row.priceEur).toBe(100_000);
    expect(row.areaSqm).toBe(120);
    expect(row.features).toBe(JSON.stringify(['garage', 'garden']));

    const snaps = await prisma.listingSnapshot.findMany({ where: { listingId: 'NEW' } });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.rawHtmlHash).toBe('abc123');
  });

  it('persistDetail updates an existing Listing on re-fetch', async () => {
    await persist.persistDetail(
      detail('OLD', { title: 'Old title', priceEur: 100_000, rawHtmlHash: 'h1' }),
    );

    await persist.persistDetail(
      detail('OLD', { title: 'New title', priceEur: 95_000, rawHtmlHash: 'h2' }),
    );

    const row = await prisma.listing.findUniqueOrThrow({ where: { id: 'OLD' } });
    expect(row.title).toBe('New title');
    expect(row.priceEur).toBe(95_000);
    expect(Date.now() - row.lastFetchedAt.getTime()).toBeLessThan(1_000);
  });

  it('persistDetail does NOT insert a snapshot when rawHtmlHash is unchanged', async () => {
    await persist.persistDetail(detail('X', { rawHtmlHash: 'abc' }));
    await persist.persistDetail(detail('X', { rawHtmlHash: 'abc' }));

    const snaps = await prisma.listingSnapshot.findMany({ where: { listingId: 'X' } });
    expect(snaps).toHaveLength(1);
  });

  it('persistDetail inserts a new snapshot when rawHtmlHash changed', async () => {
    await persist.persistDetail(detail('X', { rawHtmlHash: 'abc' }));
    await persist.persistDetail(detail('X', { rawHtmlHash: 'xyz' }));

    const snaps = await prisma.listingSnapshot.findMany({
      where: { listingId: 'X' },
      orderBy: { capturedAt: 'asc' },
    });
    expect(snaps).toHaveLength(2);
    expect(snaps[1]?.rawHtmlHash).toBe('xyz');
  });

  it('persistDetail re-activates a previously inactive listing', async () => {
    await seedListing('REVIVED', { active: false });

    await persist.persistDetail(detail('REVIVED'));

    const row = await prisma.listing.findUniqueOrThrow({ where: { id: 'REVIVED' } });
    expect(row.active).toBe(true);
  });

  it('startSweep + finishSweep round-trip', async () => {
    const { id } = await persist.startSweep();

    await persist.finishSweep(id, {
      status: 'ok',
      pagesFetched: 5,
      detailsFetched: 7,
      newListings: 3,
      updatedListings: 2,
      errors: [],
    });

    const row = await prisma.sweepRun.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('ok');
    expect(row.finishedAt).not.toBeNull();
    expect(row.pagesFetched).toBe(5);
    expect(row.detailsFetched).toBe(7);
    expect(row.newListings).toBe(3);
    expect(row.updatedListings).toBe(2);
    expect(row.errors).toBeNull();
  });

  it('finishSweep serializes errors as JSON when present', async () => {
    const { id } = await persist.startSweep();

    await persist.finishSweep(id, {
      status: 'partial',
      pagesFetched: 1,
      detailsFetched: 0,
      newListings: 0,
      updatedListings: 0,
      errors: [{ url: 'https://999.md/x', status: 500, msg: 'boom' }],
    });

    const row = await prisma.sweepRun.findUniqueOrThrow({ where: { id } });
    expect(row.errors).toBe(
      JSON.stringify([{ url: 'https://999.md/x', status: 500, msg: 'boom' }]),
    );
  });
});

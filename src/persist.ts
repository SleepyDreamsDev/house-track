// Persistence layer: Prisma upserts + snapshot diffing + sweep bookkeeping.
//
// Spec: docs/poc-spec.md §"Crawl flow (per sweep)" steps 5, 8, 9.

import type { PrismaClient } from '@prisma/client';

import type { ListingStub, ParsedDetail, SweepError, SweepStatus } from './types.js';

export interface DiffResult {
  new: ListingStub[];
  seen: ListingStub[];
}

export interface SweepResult {
  status: SweepStatus;
  pagesFetched: number;
  detailsFetched: number;
  newListings: number;
  updatedListings: number;
  errors: SweepError[];
}

export class Persistence {
  constructor(private readonly prisma: PrismaClient) {}

  async diffAgainstDb(stubs: ListingStub[]): Promise<DiffResult> {
    if (stubs.length === 0) return { new: [], seen: [] };
    const ids = stubs.map((s) => s.id);
    const existing = await this.prisma.listing.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const known = new Set(existing.map((e) => e.id));
    return {
      new: stubs.filter((s) => !known.has(s.id)),
      seen: stubs.filter((s) => known.has(s.id)),
    };
  }

  async markSeen(stubs: ListingStub[]): Promise<void> {
    if (stubs.length === 0) return;
    await this.prisma.listing.updateMany({
      where: { id: { in: stubs.map((s) => s.id) } },
      data: { lastSeenAt: new Date(), active: true },
    });
  }

  /** Flip active=false on listings whose lastSeenAt is older than `ageMs`. Returns count. */
  async markInactiveOlderThan(ageMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - ageMs);
    const res = await this.prisma.listing.updateMany({
      where: { active: true, lastSeenAt: { lt: cutoff } },
      data: { active: false },
    });
    return res.count;
  }

  async persistDetail(detail: ParsedDetail): Promise<void> {
    const now = new Date();
    const writable = {
      url: detail.url,
      title: detail.title,
      priceEur: detail.priceEur,
      priceRaw: detail.priceRaw,
      rooms: detail.rooms,
      areaSqm: detail.areaSqm,
      landSqm: detail.landSqm,
      district: detail.district,
      street: detail.street,
      floors: detail.floors,
      yearBuilt: detail.yearBuilt,
      heatingType: detail.heatingType,
      description: detail.description,
      features: JSON.stringify(detail.features),
      imageUrls: JSON.stringify(detail.imageUrls),
      sellerType: detail.sellerType,
      postedAt: detail.postedAt,
      bumpedAt: detail.bumpedAt,
    };

    await this.prisma.listing.upsert({
      where: { id: detail.id },
      create: { id: detail.id, ...writable, lastSeenAt: now, lastFetchedAt: now },
      update: { ...writable, lastSeenAt: now, lastFetchedAt: now, active: true },
    });

    const latest = await this.prisma.listingSnapshot.findFirst({
      where: { listingId: detail.id },
      orderBy: { capturedAt: 'desc' },
      select: { rawHtmlHash: true },
    });

    if (latest?.rawHtmlHash !== detail.rawHtmlHash) {
      await this.prisma.listingSnapshot.create({
        data: {
          listingId: detail.id,
          priceEur: detail.priceEur,
          description: detail.description,
          rawHtmlHash: detail.rawHtmlHash,
        },
      });
    }
  }

  async startSweep(): Promise<{ id: number }> {
    const row = await this.prisma.sweepRun.create({
      data: { status: 'in_progress' },
    });
    return { id: row.id };
  }

  async finishSweep(id: number, result: SweepResult): Promise<void> {
    await this.prisma.sweepRun.update({
      where: { id },
      data: {
        finishedAt: new Date(),
        status: result.status,
        pagesFetched: result.pagesFetched,
        detailsFetched: result.detailsFetched,
        newListings: result.newListings,
        updatedListings: result.updatedListings,
        errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      },
    });
  }
}

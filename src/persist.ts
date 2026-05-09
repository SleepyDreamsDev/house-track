// Persistence layer: Prisma upserts + snapshot diffing + sweep bookkeeping.
//
// Spec: docs/poc-spec.md §"Crawl flow (per sweep)" steps 5, 8, 9.

import { Prisma, type PrismaClient } from '@prisma/client';

import { bootstrapLutFromConfig, type TaxonomyLut } from './parse-taxonomy.js';
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
  configSnapshot?: Record<string, unknown> | null;
  pagesDetail?: Array<{
    n: number;
    url: string;
    status?: number;
    bytes?: number;
    parseMs: number;
    found: number;
    took: number;
  }> | null;
  detailsDetail?: Array<{
    id: string;
    url: string;
    status?: number;
    bytes?: number;
    parseMs: number;
    action: 'new' | 'updated';
    priceEur?: number | null;
  }> | null;
  eventLog?: unknown[] | null;
}

export class Persistence {
  private readonly taxonomyLut: TaxonomyLut;

  constructor(
    private readonly prisma: PrismaClient,
    taxonomyLut?: TaxonomyLut,
  ) {
    this.taxonomyLut = taxonomyLut ?? bootstrapLutFromConfig();
  }

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
      features: detail.features,
      imageUrls: detail.imageUrls,
      sellerType: detail.sellerType,
      postedAt: detail.postedAt,
      bumpedAt: detail.bumpedAt,
      filterValuesEnrichedAt: now,
    };

    // Listing upsert + filter-value replace + snapshot decision must be atomic
    // so a crash mid-write can never leave a half-enriched listing.
    await this.prisma.$transaction(async (tx) => {
      await tx.listing.upsert({
        where: { id: detail.id },
        create: { id: detail.id, ...writable, lastSeenAt: now, lastFetchedAt: now },
        update: { ...writable, lastSeenAt: now, lastFetchedAt: now, active: true },
      });

      // Replace, don't merge — otherwise a removed feature on 999.md would
      // linger in our DB forever. Cheap on SQLite for the row counts we have
      // (typically <30 triples per listing).
      await tx.listingFilterValue.deleteMany({ where: { listingId: detail.id } });
      if (detail.filterValues.length > 0) {
        await tx.listingFilterValue.createMany({
          data: detail.filterValues.map((t) => ({
            listingId: detail.id,
            filterId: this.taxonomyLut.get(t.featureId) ?? t.filterId,
            featureId: t.featureId,
            optionId: t.optionId,
            textValue: t.textValue,
            numericValue: t.numericValue,
          })),
        });
      }

      const latest = await tx.listingSnapshot.findFirst({
        where: { listingId: detail.id },
        orderBy: { capturedAt: 'desc' },
        select: { rawHtmlHash: true },
      });

      if (latest?.rawHtmlHash !== detail.rawHtmlHash) {
        await tx.listingSnapshot.create({
          data: {
            listingId: detail.id,
            priceEur: detail.priceEur,
            description: detail.description,
            rawHtmlHash: detail.rawHtmlHash,
          },
        });
      }
    });
  }

  /**
   * Returns up to `limit` listing ids that have never had a successful detail
   * fetch (filterValuesEnrichedAt IS NULL), oldest by lastFetchedAt first.
   * Used by the sweep's trickle backfill — see SWEEP.backfillPerSweep.
   */
  async findUnenrichedListings(limit: number): Promise<string[]> {
    if (limit <= 0) return [];
    const rows = await this.prisma.listing.findMany({
      where: { filterValuesEnrichedAt: null, active: true },
      orderBy: { lastFetchedAt: 'asc' },
      select: { id: true },
      take: limit,
    });
    return rows.map((r) => r.id);
  }

  async startSweep(opts?: {
    source?: string;
    trigger?: string;
  }): Promise<{ id: number; startedAt: Date }> {
    const row = await this.prisma.sweepRun.create({
      data: {
        status: 'in_progress',
        ...(opts?.source && { source: opts.source }),
        ...(opts?.trigger && { trigger: opts.trigger }),
      },
    });
    return { id: row.id, startedAt: row.startedAt };
  }

  // Incrementally publish progress to the SweepRun row so the operator UI
  // shows live counters during a long-running sweep. Called from the crawler
  // after each page/detail fetch — one extra UPDATE per ~8s pacing tick is
  // negligible alongside the politeness budget. `errors` is replaced wholesale
  // because the array is short (rate-limited by the circuit breaker) and
  // partial-array updates would require fragile JSONB merging.
  async recordSweepProgress(
    id: number,
    snapshot: {
      pagesFetched?: number;
      detailsFetched?: number;
      newListings?: number;
      updatedListings?: number;
      errors?: SweepResult['errors'];
    },
  ): Promise<void> {
    const data: Prisma.SweepRunUpdateInput = {};
    if (snapshot.pagesFetched !== undefined) data.pagesFetched = snapshot.pagesFetched;
    if (snapshot.detailsFetched !== undefined) data.detailsFetched = snapshot.detailsFetched;
    if (snapshot.newListings !== undefined) data.newListings = snapshot.newListings;
    if (snapshot.updatedListings !== undefined) data.updatedListings = snapshot.updatedListings;
    if (snapshot.errors !== undefined) {
      data.errors =
        snapshot.errors.length > 0
          ? (snapshot.errors as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull;
    }
    await this.prisma.sweepRun.update({ where: { id }, data });
  }

  async snapshotConfig(): Promise<Record<string, unknown>> {
    // Use this instance's prisma client instead of a separate getPrisma() singleton
    // to avoid split-brain reads when Persistence is constructed with a different client
    const allSettings = await this.prisma.setting.findMany();
    const snapshot: Record<string, unknown> = {};
    for (const setting of allSettings) {
      snapshot[setting.key] = setting.valueJson;
    }
    return snapshot;
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
        errors:
          result.errors.length > 0
            ? (result.errors as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        configSnapshot:
          result.configSnapshot !== null && result.configSnapshot !== undefined
            ? (result.configSnapshot as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        pagesDetail:
          result.pagesDetail && result.pagesDetail.length > 0
            ? (result.pagesDetail as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        detailsDetail:
          result.detailsDetail && result.detailsDetail.length > 0
            ? (result.detailsDetail as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        eventLog:
          result.eventLog && Array.isArray(result.eventLog) && result.eventLog.length > 0
            ? (result.eventLog as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
      },
    });
  }
}

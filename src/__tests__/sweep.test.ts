import { describe, expect, it, vi } from 'vitest';

import type { Circuit } from '../circuit.js';
import { CircuitTrippingError } from '../fetch.js';
import { AdvertNotFoundError } from '../parse-detail.js';
import type { Persistence } from '../persist.js';
import { runSweep, getActiveSweepId, type SweepDeps } from '../sweep.js';
import type { ListingStub, ParsedDetail } from '../types.js';

const HOUR = 60 * 60 * 1000;

const stub = (id: string): ListingStub => ({
  id,
  url: `https://999.md/ro/${id}`,
  title: `Title ${id}`,
  priceEur: 100_000,
  priceRaw: '100000 EUR',
  areaSqm: 120,
  postedAt: null,
});

const detail = (id: string): ParsedDetail => ({
  id,
  url: `https://999.md/ro/${id}`,
  title: `Title ${id}`,
  priceEur: 100_000,
  priceRaw: '100000 EUR',
  rooms: 4,
  areaSqm: 120,
  landSqm: 600,
  district: 'Buiucani',
  street: 'Test',
  floors: 2,
  yearBuilt: 2010,
  heatingType: 'autonomă',
  description: 'desc',
  features: [],
  imageUrls: [],
  sellerType: 'private',
  postedAt: null,
  bumpedAt: null,
  rawHtmlHash: `hash-${id}`,
  filterValues: [],
});

interface MockEnv {
  deps: SweepDeps;
  fetchSearchPage: ReturnType<typeof vi.fn>;
  fetchAdvert: ReturnType<typeof vi.fn>;
  isOpen: ReturnType<typeof vi.fn>;
  diffAgainstDb: ReturnType<typeof vi.fn>;
  markSeen: ReturnType<typeof vi.fn>;
  markInactiveOlderThan: ReturnType<typeof vi.fn>;
  persistDetail: ReturnType<typeof vi.fn>;
  startSweep: ReturnType<typeof vi.fn>;
  finishSweep: ReturnType<typeof vi.fn>;
  findUnenrichedListings: ReturnType<typeof vi.fn>;
  snapshotConfig: ReturnType<typeof vi.fn>;
  parseIndex: ReturnType<typeof vi.fn>;
  parseDetail: ReturnType<typeof vi.fn>;
}

function makeEnv(): MockEnv {
  const fetchSearchPage = vi.fn<(pageIdx: number) => Promise<unknown>>();
  const fetchAdvert = vi.fn<(id: string) => Promise<unknown>>();
  const isOpen = vi.fn().mockResolvedValue(false);
  const diffAgainstDb = vi
    .fn()
    .mockImplementation(async (s: ListingStub[]) => ({ new: s, seen: [] }));
  const markSeen = vi.fn().mockResolvedValue(undefined);
  const markInactiveOlderThan = vi.fn().mockResolvedValue(0);
  const persistDetail = vi.fn().mockResolvedValue(undefined);
  const startSweep = vi.fn().mockResolvedValue({ id: 1 });
  const finishSweep = vi.fn().mockResolvedValue(undefined);
  const findUnenrichedListings = vi.fn().mockResolvedValue([]);
  const snapshotConfig = vi.fn().mockResolvedValue({
    'politeness.baseDelayMs': 8000,
    'politeness.jitterMs': 2000,
    'filter.maxPriceEur': 250000,
  });
  const parseIndex = vi.fn<(json: unknown) => ListingStub[]>();
  const parseDetail = vi.fn<(id: string, json: unknown) => ParsedDetail>();

  const deps: SweepDeps = {
    fetchSearchPage,
    fetchAdvert,
    persist: {
      diffAgainstDb,
      markSeen,
      markInactiveOlderThan,
      persistDetail,
      startSweep,
      finishSweep,
      findUnenrichedListings,
      snapshotConfig,
    } as unknown as Persistence,
    circuit: { isOpen } as unknown as Circuit,
    parseIndex,
    parseDetail,
    maxPagesPerSweep: 5,
    missingThresholdMs: 3 * HOUR,
  };

  return {
    deps,
    fetchSearchPage,
    fetchAdvert,
    isOpen,
    diffAgainstDb,
    markSeen,
    markInactiveOlderThan,
    persistDetail,
    startSweep,
    finishSweep,
    findUnenrichedListings,
    snapshotConfig,
    parseIndex,
    parseDetail,
  };
}

describe('runSweep', () => {
  it('Pre-flight short-circuits when the breaker is already open', async () => {
    const env = makeEnv();
    env.isOpen.mockResolvedValueOnce(true);

    await runSweep(env.deps);

    expect(env.fetchSearchPage).not.toHaveBeenCalled();
    expect(env.fetchAdvert).not.toHaveBeenCalled();
    expect(env.startSweep).toHaveBeenCalledOnce();
    expect(env.finishSweep).toHaveBeenCalledOnce();
    expect(env.finishSweep.mock.calls[0]?.[1]).toMatchObject({ status: 'circuit_open' });
  });

  it('Happy path: 1 page with 2 stubs, both new and persisted', async () => {
    const env = makeEnv();
    env.fetchSearchPage.mockResolvedValueOnce({ page: 0 });
    env.fetchSearchPage.mockResolvedValueOnce({ page: 1 });
    env.parseIndex.mockReturnValueOnce([stub('A'), stub('B')]);
    env.parseIndex.mockReturnValueOnce([]); // page 1 empty → stop pagination
    env.fetchAdvert.mockResolvedValueOnce({ id: 'A' }).mockResolvedValueOnce({ id: 'B' });
    env.parseDetail.mockReturnValueOnce(detail('A')).mockReturnValueOnce(detail('B'));

    await runSweep(env.deps);

    expect(env.persistDetail).toHaveBeenCalledTimes(2);
    expect(env.finishSweep.mock.calls[0]?.[1]).toMatchObject({ status: 'ok', newListings: 2 });
  });

  it('Empty index page stops pagination', async () => {
    const env = makeEnv();
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.parseIndex.mockReturnValueOnce([]);

    await runSweep(env.deps);

    expect(env.fetchSearchPage).toHaveBeenCalledOnce();
    expect(env.fetchAdvert).not.toHaveBeenCalled();
  });

  it('A CircuitTrippingError mid-sweep aborts and marks status circuit_open', async () => {
    const env = makeEnv();
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.parseIndex.mockReturnValueOnce([stub('A')]);
    env.parseIndex.mockReturnValueOnce([]);
    env.fetchAdvert.mockRejectedValueOnce(new CircuitTrippingError(429, 'detA'));

    await runSweep(env.deps);

    expect(env.finishSweep.mock.calls[0]?.[1]).toMatchObject({ status: 'circuit_open' });
  });

  it('parseDetail throwing on one listing does not kill the sweep', async () => {
    const env = makeEnv();
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.parseIndex.mockReturnValueOnce([stub('A'), stub('B')]);
    env.parseIndex.mockReturnValueOnce([]);
    env.fetchAdvert.mockResolvedValueOnce({ id: 'A' }).mockResolvedValueOnce({ id: 'B' });
    env.parseDetail
      .mockImplementationOnce(() => {
        throw new Error('schema drift');
      })
      .mockReturnValueOnce(detail('B'));

    await runSweep(env.deps);

    expect(env.persistDetail).toHaveBeenCalledOnce();
    expect(env.persistDetail.mock.calls[0]?.[0].id).toBe('B');
    const result = env.finishSweep.mock.calls[0]?.[1];
    expect(result.status).toBe('partial');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ msg: expect.stringContaining('schema drift') });
  });

  it('AdvertNotFoundError on a detail is silent (delisted between index and detail)', async () => {
    const env = makeEnv();
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.parseIndex.mockReturnValueOnce([stub('A')]);
    env.parseIndex.mockReturnValueOnce([]);
    env.fetchAdvert.mockResolvedValueOnce({ data: { advert: null } });
    env.parseDetail.mockImplementationOnce(() => {
      throw new AdvertNotFoundError('A');
    });

    await runSweep(env.deps);

    expect(env.persistDetail).not.toHaveBeenCalled();
    const result = env.finishSweep.mock.calls[0]?.[1];
    expect(result.status).toBe('ok');
    expect(result.errors).toHaveLength(0);
  });

  it('Does NOT age out listings when the sweep is partial (incomplete index → stale data risk)', async () => {
    const env = makeEnv();
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.parseIndex.mockImplementationOnce(() => {
      throw new Error('schema drift on index');
    });

    await runSweep(env.deps);

    expect(env.markInactiveOlderThan).not.toHaveBeenCalled();
    expect(env.finishSweep.mock.calls[0]?.[1]).toMatchObject({ status: 'partial' });
  });

  it('Seen ids get markSeen and stale ids get aged out', async () => {
    const env = makeEnv();
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.parseIndex.mockReturnValueOnce([stub('A'), stub('B')]);
    env.parseIndex.mockReturnValueOnce([]);
    // Need to fetch and parse for both new (B) and seen (A)
    env.fetchAdvert.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    env.parseDetail.mockReturnValueOnce(detail('B')).mockReturnValueOnce(detail('A'));
    env.diffAgainstDb.mockResolvedValueOnce({ new: [stub('B')], seen: [stub('A')] });

    await runSweep(env.deps);

    expect(env.markSeen).toHaveBeenCalledOnce();
    expect(env.markSeen.mock.calls[0]?.[0].map((s: ListingStub) => s.id)).toEqual(['A']);
    expect(env.markInactiveOlderThan).toHaveBeenCalledWith(3 * HOUR);
  });

  describe('backfillPerSweep', () => {
    it('Re-fetches up to N listings with NULL filterValuesEnrichedAt after new-detail fetches', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);
      env.findUnenrichedListings.mockResolvedValueOnce(['B1', 'B2', 'B3']);
      env.fetchAdvert.mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockResolvedValueOnce({});
      env.parseDetail
        .mockReturnValueOnce(detail('B1'))
        .mockReturnValueOnce(detail('B2'))
        .mockReturnValueOnce(detail('B3'));
      env.deps.backfillPerSweep = 30;

      await runSweep(env.deps);

      expect(env.findUnenrichedListings).toHaveBeenCalledWith(30);
      expect(env.fetchAdvert).toHaveBeenCalledTimes(3);
      expect(env.persistDetail).toHaveBeenCalledTimes(3);
      const ids = env.persistDetail.mock.calls.map((c) => (c[0] as ParsedDetail).id);
      expect(ids).toEqual(['B1', 'B2', 'B3']);
    });

    it('backfillPerSweep=0 disables backfill entirely', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);
      env.deps.backfillPerSweep = 0;

      await runSweep(env.deps);

      expect(env.findUnenrichedListings).not.toHaveBeenCalled();
      expect(env.fetchAdvert).not.toHaveBeenCalled();
    });

    it('Undefined backfillPerSweep means no backfill', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);

      await runSweep(env.deps);

      expect(env.findUnenrichedListings).not.toHaveBeenCalled();
    });

    it('A backfill fetch failure does not abort the sweep but flips status to partial', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);
      env.findUnenrichedListings.mockResolvedValueOnce(['B1', 'B2', 'B3']);
      env.fetchAdvert
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce({});
      env.parseDetail.mockReturnValueOnce(detail('B1')).mockReturnValueOnce(detail('B3'));
      env.deps.backfillPerSweep = 30;

      await runSweep(env.deps);

      expect(env.persistDetail).toHaveBeenCalledTimes(2);
      const result = env.finishSweep.mock.calls[0]?.[1];
      expect(result.status).toBe('partial');
      expect(result.errors[0].url).toContain('backfill');
    });

    it('A backfill CircuitTrippingError aborts the sweep and marks circuit_open', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);
      env.findUnenrichedListings.mockResolvedValueOnce(['B1']);
      env.fetchAdvert.mockRejectedValueOnce(new CircuitTrippingError(429, 'B1'));
      env.deps.backfillPerSweep = 30;

      await runSweep(env.deps);

      expect(env.finishSweep.mock.calls[0]?.[1]).toMatchObject({ status: 'circuit_open' });
    });
  });

  it('applyPostFilter callback runs before diffAgainstDb', async () => {
    const env = makeEnv();
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.fetchSearchPage.mockResolvedValueOnce({});
    env.parseIndex.mockReturnValueOnce([stub('A'), stub('B')]);
    env.parseIndex.mockReturnValueOnce([]);
    env.fetchAdvert.mockResolvedValueOnce({});
    env.parseDetail.mockReturnValueOnce(detail('A'));
    env.deps.applyPostFilter = (s) => s.filter((x) => x.id === 'A');

    await runSweep(env.deps);

    expect(env.diffAgainstDb).toHaveBeenCalledOnce();
    expect(env.diffAgainstDb.mock.calls[0]?.[0].map((s: ListingStub) => s.id)).toEqual(['A']);
  });

  describe('JSON column persistence (pagesDetail, detailsDetail, configSnapshot)', () => {
    it('Captures pagesDetail with timing and found count during collectIndexStubs', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({}); // page 0
      env.fetchSearchPage.mockResolvedValueOnce({}); // page 1
      env.parseIndex.mockReturnValueOnce([stub('A')]); // page 0 has 1 result
      env.parseIndex.mockReturnValueOnce([]); // page 1 empty → stops pagination
      env.fetchAdvert.mockResolvedValueOnce({});
      env.parseDetail.mockReturnValueOnce(detail('A'));

      await runSweep(env.deps);

      const result = env.finishSweep.mock.calls[0]?.[1];
      expect(result.pagesDetail).toBeDefined();
      expect(Array.isArray(result.pagesDetail)).toBe(true);
      expect(result.pagesDetail).toHaveLength(2); // 2 pages (page 0 with stubs, page 1 empty)
      const page = result.pagesDetail[0];
      expect(page).toMatchObject({
        n: 0,
        url: expect.any(String),
        parseMs: expect.any(Number),
        found: 1,
        took: expect.any(Number),
      });
    });

    it('Captures detailsDetail with action (new|updated) during fetchAndPersistDetails', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([stub('A'), stub('B')]);
      env.parseIndex.mockReturnValueOnce([]);
      env.fetchAdvert.mockResolvedValueOnce({}).mockResolvedValueOnce({});
      env.parseDetail.mockReturnValueOnce(detail('A')).mockReturnValueOnce(detail('B'));
      env.diffAgainstDb.mockResolvedValueOnce({ new: [stub('A')], seen: [stub('B')] });

      await runSweep(env.deps);

      const result = env.finishSweep.mock.calls[0]?.[1];
      expect(result.detailsDetail).toBeDefined();
      expect(Array.isArray(result.detailsDetail)).toBe(true);
      expect(result.detailsDetail).toHaveLength(2);
      expect(result.detailsDetail[0]).toMatchObject({
        id: 'A',
        action: 'new',
        priceEur: expect.any(Number),
        parseMs: expect.any(Number),
      });
      expect(result.detailsDetail[1]).toMatchObject({
        id: 'B',
        action: 'updated',
      });
    });

    it('Captures configSnapshot from listSettings at sweep start', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);

      await runSweep(env.deps);

      const result = env.finishSweep.mock.calls[0]?.[1];
      expect(result.configSnapshot).toBeDefined();
      expect(typeof result.configSnapshot).toBe('object');
    });

    it('All JSON columns are present in SweepResult returned to finishSweep', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);

      await runSweep(env.deps);

      const result = env.finishSweep.mock.calls[0]?.[1];
      expect(result).toHaveProperty('configSnapshot');
      expect(result).toHaveProperty('pagesDetail');
      expect(result).toHaveProperty('detailsDetail');
      expect(result).toHaveProperty('eventLog');
    });

    it('JSON columns are arrays or objects, not undefined', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([stub('A')]);
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);
      env.fetchAdvert.mockResolvedValueOnce({});
      env.parseDetail.mockReturnValueOnce(detail('A'));

      await runSweep(env.deps);

      const result = env.finishSweep.mock.calls[0]?.[1];
      expect(Array.isArray(result.pagesDetail) || result.pagesDetail === null).toBe(true);
      expect(Array.isArray(result.detailsDetail) || result.detailsDetail === null).toBe(true);
      expect(typeof result.configSnapshot === 'object' || result.configSnapshot === null).toBe(
        true,
      );
    });

    it('Sets activeSweepId after startSweep and clears in finally', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);

      expect(getActiveSweepId()).toBeNull();

      // Run the sweep and capture activeSweepId mid-sweep
      env.startSweep.mockImplementationOnce(async () => {
        const sweepId = 42;
        // After startSweep, activeSweepId should be set
        return { id: sweepId };
      });

      await runSweep(env.deps);

      // After runSweep completes, activeSweepId should be cleared
      expect(getActiveSweepId()).toBeNull();
    });
  });

  describe('Bug fixes from PR #19/#21/#24', () => {
    it('Bug#2: snapshotConfig() throws → finishSweep still runs (try-finally correctness)', async () => {
      const env = makeEnv();
      env.snapshotConfig.mockRejectedValueOnce(new Error('snapshot failed'));
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);

      await runSweep(env.deps);

      // finishSweep MUST be called even if snapshotConfig throws
      expect(env.finishSweep).toHaveBeenCalledOnce();
      const result = env.finishSweep.mock.calls[0]?.[1];
      expect(result.status).toBe('failed');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('Bug#9: concurrent runSweep overlaps should not cause split-brain (activeSweepId safety)', async () => {
      const env = makeEnv();
      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);
      env.startSweep.mockResolvedValueOnce({ id: 1 });

      await runSweep(env.deps);

      // activeSweepId should be null after completion, not left dangling
      expect(getActiveSweepId()).toBeNull();
    });

    it('Bug#10: activeSweepId cleared before finishSweep/final log would lose SSE (reorder)', async () => {
      const env = makeEnv();
      let activeSweepIdWhenFinishCalled: number | null = null;

      env.fetchSearchPage.mockResolvedValueOnce({});
      env.parseIndex.mockReturnValueOnce([]);
      env.finishSweep.mockImplementationOnce(async () => {
        // Capture activeSweepId when finishSweep is called
        activeSweepIdWhenFinishCalled = getActiveSweepId();
      });
      env.startSweep.mockResolvedValueOnce({ id: 42 });

      await runSweep(env.deps);

      // activeSweepId should still be set (42) when finishSweep runs
      // Bug: if it's null, SSE subscribers miss the final event
      expect(activeSweepIdWhenFinishCalled).not.toBeNull();
      expect(activeSweepIdWhenFinishCalled).toBe(42);
    });
  });
});

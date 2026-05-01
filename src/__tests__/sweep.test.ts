import { describe, expect, it, vi } from 'vitest';

import type { Circuit } from '../circuit.js';
import { CircuitTrippingError } from '../fetch.js';
import { AdvertNotFoundError } from '../parse-detail.js';
import type { Persistence } from '../persist.js';
import { runSweep, type SweepDeps } from '../sweep.js';
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
    env.fetchAdvert.mockResolvedValueOnce({});
    env.parseDetail.mockReturnValueOnce(detail('B'));
    env.diffAgainstDb.mockResolvedValueOnce({ new: [stub('B')], seen: [stub('A')] });

    await runSweep(env.deps);

    expect(env.markSeen).toHaveBeenCalledOnce();
    expect(env.markSeen.mock.calls[0]?.[0].map((s: ListingStub) => s.id)).toEqual(['A']);
    expect(env.markInactiveOlderThan).toHaveBeenCalledWith(3 * HOUR);
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
});

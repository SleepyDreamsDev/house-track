// One sweep tick: pre-flight → paginate index → diff → fetch+parse+persist
// details for new ids → markSeen / markInactiveOlderThan → finishSweep.
//
// Spec: docs/poc-spec.md §"Crawl flow (per sweep)".
// Now GraphQL-native: the sweep takes opaque `fetchSearchPage(pageIdx)` and
// `fetchAdvert(id)` callbacks rather than raw URLs, so it doesn't have to know
// the operation strings or variable shapes.

import type { Circuit } from './circuit.js';
import { CircuitTrippingError } from './fetch.js';
import type { Logger } from './log.js';
import type { Persistence, SweepResult } from './persist.js';
import { AdvertNotFoundError } from './parse-detail.js';
import type { PostFilter } from './parse-index.js';
import type { ListingStub, ParsedDetail, SweepError, SweepStatus } from './types.js';

// Module-level variable tracking the currently active sweep (if any)
// for log.ts to subscribe to EventEmitter on per-sweep basis.
let activeSweepId: number | null = null;

export function getActiveSweepId(): number | null {
  return activeSweepId;
}

// Module-level state tracking the listing URL we're currently fetching during
// fetchAndPersistDetails. Surfaced via GET /api/sweeps/:id so the SweepDetail
// page's live banner can show the in-flight URL.
let currentlyFetching: { url: string; startedAt: number } | null = null;

export function getCurrentlyFetching(): { url: string; startedAt: number } | null {
  return currentlyFetching;
}

export function setCurrentlyFetching(url: string | null): void {
  currentlyFetching = url ? { url, startedAt: Date.now() } : null;
}

// Module-level map of active sweeps to their AbortControllers
// Keyed by sweepId; register on start, delete on finish
const sweepAbortControllers = new Map<number, AbortController>();

export function getSweepAbortControllers(): Map<number, AbortController> {
  return sweepAbortControllers;
}

export interface SweepDeps {
  fetchSearchPage: (pageIdx: number, signal?: AbortSignal) => Promise<unknown>;
  fetchAdvert: (id: string, signal?: AbortSignal) => Promise<unknown>;
  persist: Pick<
    Persistence,
    | 'diffAgainstDb'
    | 'markSeen'
    | 'markInactiveOlderThan'
    | 'persistDetail'
    | 'startSweep'
    | 'finishSweep'
    | 'findUnenrichedListings'
    | 'snapshotConfig'
    | 'recordSweepProgress'
  >;
  circuit: Pick<Circuit, 'isOpen'>;
  parseIndex: (json: unknown) => ListingStub[];
  parseDetail: (id: string, json: unknown) => ParsedDetail;
  applyPostFilter?: (stubs: ListingStub[]) => ListingStub[];
  postFilter?: PostFilter;
  maxPagesPerSweep: number;
  missingThresholdMs: number;
  /** Cap on per-sweep backfill of listings with NULL filterValuesEnrichedAt. 0 disables. */
  backfillPerSweep?: number;
  /** If accumulated listings cross this, stop paginating early. Computed
   *  per-tick (in index.ts) so each sweep varies in size. Defaults to a
   *  high value if absent — preserves prior behavior in tests. */
  targetListingsThisSweep?: number;
  log?: Logger;
}

export async function runSweep(deps: SweepDeps, initialSweepId?: number): Promise<void> {
  if (await deps.circuit.isOpen()) {
    deps.log?.warn({ event: 'sweep.skip', reason: 'circuit_open' });
    const { id } = await deps.persist.startSweep();
    await deps.persist.finishSweep(id, emptyResult('circuit_open'));
    return;
  }

  const sweepId = initialSweepId || (await deps.persist.startSweep()).id;
  activeSweepId = sweepId;
  const controller = new AbortController();
  sweepAbortControllers.set(sweepId, controller);
  const result: SweepResult = emptyResult('ok');

  try {
    // Capture config snapshot at sweep start (inside try so error triggers catch → finishSweep)
    result.configSnapshot = await deps.persist.snapshotConfig();
    const allStubs = await collectIndexStubs(deps, result, controller.signal, sweepId);
    const stubs = deps.applyPostFilter ? deps.applyPostFilter(allStubs) : allStubs;
    const { new: newStubs, seen: seenStubs } = await deps.persist.diffAgainstDb(stubs);
    result.newListings = newStubs.length;
    await publishProgress(deps, sweepId, result);

    await fetchAndPersistDetails(deps, newStubs, seenStubs, result, controller.signal, sweepId);
    await backfillUnenriched(deps, result, controller.signal, sweepId);

    await deps.persist.markSeen(seenStubs);
    result.updatedListings = seenStubs.length;
    await publishProgress(deps, sweepId, result);
    // Only age out when this sweep saw a complete index. A partial sweep means
    // some listings would be missing for a reason unrelated to delisting, so
    // aging them out would corrupt the active set.
    if (result.status === 'ok') {
      await deps.persist.markInactiveOlderThan(deps.missingThresholdMs);
    }
  } catch (err) {
    if (err instanceof CircuitTrippingError) {
      result.status = 'circuit_open';
    } else if (controller.signal.aborted) {
      result.status = 'cancelled';
    } else {
      result.status = 'failed';
      result.errors.push({ url: '<sweep>', status: null, msg: String(err) });
    }
  } finally {
    // Keep activeSweepId set until after finishSweep + final log so SSE subscribers get final events
    sweepAbortControllers.delete(sweepId);
    await deps.persist.finishSweep(sweepId, result);
    deps.log?.info({ event: 'sweep.done', ...result });
    // Clear activeSweepId only after all final operations complete
    activeSweepId = null;
    setCurrentlyFetching(null);
  }
}

// Best-effort flush of in-memory counters to the SweepRun row. The operator UI
// polls /api/sweeps every few seconds while a sweep is running; without these
// flushes the row stays at zeros until finishSweep, hiding all progress.
// Wrapped in try/catch so a transient DB blip doesn't abort the sweep — the
// next flush (or finishSweep) will reconcile.
async function publishProgress(
  deps: SweepDeps,
  sweepId: number,
  result: SweepResult,
): Promise<void> {
  try {
    await deps.persist.recordSweepProgress(sweepId, {
      pagesFetched: result.pagesFetched,
      detailsFetched: result.detailsFetched,
      newListings: result.newListings,
      updatedListings: result.updatedListings,
      errors: result.errors,
    });
  } catch (err) {
    deps.log?.warn({ event: 'sweep.progress.publish_failed', err: String(err) });
  }
}

async function collectIndexStubs(
  deps: SweepDeps,
  result: SweepResult,
  signal: AbortSignal,
  sweepId: number,
): Promise<ListingStub[]> {
  const all: ListingStub[] = [];
  if (!result.pagesDetail) result.pagesDetail = [];

  for (let page = 0; page < deps.maxPagesPerSweep; page++) {
    if (signal.aborted) {
      break;
    }
    const pageStart = Date.now();
    const json = await deps.fetchSearchPage(page, signal); // CircuitTrippingError bubbles
    result.pagesFetched += 1;
    await publishProgress(deps, sweepId, result);

    let stubs: ListingStub[];
    const parseStart = Date.now();
    try {
      stubs = deps.parseIndex(json);
    } catch (err) {
      record(result, {
        url: `<search-page-${page}>`,
        status: null,
        msg: `parseIndex: ${String(err)}`,
      });
      result.status = 'partial';
      break;
    }
    const parseMs = Date.now() - parseStart;

    // Capture page detail
    // Note: rawText is not available here; using JSON.stringify for now.
    // TODO: Pass rawText from fetchSearchPage to measure actual bytes.
    const pageDetail = {
      n: page,
      url: `<search-page-${page}>`,
      status: 200,
      parseMs,
      found: stubs.length,
      took: Date.now() - pageStart,
    };
    result.pagesDetail.push(pageDetail);

    if (stubs.length === 0) break;
    all.push(...stubs);
    if (deps.targetListingsThisSweep !== undefined && all.length >= deps.targetListingsThisSweep) {
      break;
    }
  }
  return all;
}

async function fetchAndPersistDetails(
  deps: SweepDeps,
  newStubs: ListingStub[],
  seenStubs: ListingStub[],
  result: SweepResult,
  signal: AbortSignal,
  sweepId: number,
): Promise<void> {
  if (!result.detailsDetail) result.detailsDetail = [];

  // Process new listings: fetch, parse, persist, and capture details
  for (const s of newStubs) {
    if (signal.aborted) {
      break;
    }
    setCurrentlyFetching(s.url);
    let json: unknown;
    try {
      json = await deps.fetchAdvert(s.id, signal);
    } catch (err) {
      if (err instanceof CircuitTrippingError) throw err;
      record(result, { url: s.url, status: null, msg: String(err) });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }
    result.detailsFetched += 1;

    let parsed: ParsedDetail;
    const parseStart = Date.now();
    try {
      parsed = deps.parseDetail(s.id, json);
    } catch (err) {
      if (err instanceof AdvertNotFoundError) continue; // delisted between index and detail — not an error
      record(result, { url: s.url, status: null, msg: `parseDetail: ${String(err)}` });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }
    const parseMs = Date.now() - parseStart;

    // Capture detail info for new listing
    // Note: rawText is not available here; using response size estimation.
    // TODO: Pass rawText from fetchAdvert to measure actual bytes.
    const detailRecord = {
      id: s.id,
      url: s.url,
      status: 200,
      parseMs,
      action: 'new' as const,
      priceEur: parsed.priceEur ?? null,
    };
    result.detailsDetail.push(detailRecord);

    try {
      await deps.persist.persistDetail(parsed);
    } catch (err) {
      record(result, { url: s.url, status: null, msg: `persist: ${String(err)}` });
      result.status = 'partial';
    }
    await publishProgress(deps, sweepId, result);
  }

  // Capture detail records for seen listings (fetch + parse only, no persist)
  for (const s of seenStubs) {
    if (signal.aborted) {
      break;
    }
    setCurrentlyFetching(s.url);
    let json: unknown;
    try {
      json = await deps.fetchAdvert(s.id, signal);
    } catch (err) {
      if (err instanceof CircuitTrippingError) throw err;
      record(result, { url: s.url, status: null, msg: String(err) });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }

    let parsed: ParsedDetail;
    const parseStart = Date.now();
    try {
      parsed = deps.parseDetail(s.id, json);
    } catch (err) {
      if (err instanceof AdvertNotFoundError) continue; // delisted between index and detail — not an error
      record(result, { url: s.url, status: null, msg: `parseDetail: ${String(err)}` });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }
    const parseMs = Date.now() - parseStart;

    // Capture detail info for seen listing
    // Note: rawText is not available here; using response size estimation.
    // TODO: Pass rawText from fetchAdvert to measure actual bytes.
    const detailRecord = {
      id: s.id,
      url: s.url,
      status: 200,
      parseMs,
      action: 'updated' as const,
      priceEur: parsed.priceEur ?? null,
    };
    result.detailsDetail.push(detailRecord);
  }
  setCurrentlyFetching(null);
}

// Re-fetches up to `deps.backfillPerSweep` listings whose filterValuesEnrichedAt
// is NULL (legacy rows from before the schema enrichment landed). Each call goes
// through the same fetch+parse+persist path as a new-listing detail, so it
// respects the politeness budget and adds nothing new to the request shape.
async function backfillUnenriched(
  deps: SweepDeps,
  result: SweepResult,
  signal: AbortSignal,
  sweepId: number,
): Promise<void> {
  const limit = deps.backfillPerSweep ?? 0;
  if (limit <= 0) return;
  const ids = await deps.persist.findUnenrichedListings(limit);
  for (const id of ids) {
    if (signal.aborted) {
      break;
    }
    const url = `<backfill:${id}>`;
    let json: unknown;
    try {
      json = await deps.fetchAdvert(id, signal);
    } catch (err) {
      if (err instanceof CircuitTrippingError) throw err;
      record(result, { url, status: null, msg: String(err) });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }
    result.detailsFetched += 1;

    let parsed: ParsedDetail;
    try {
      parsed = deps.parseDetail(id, json);
    } catch (err) {
      if (err instanceof AdvertNotFoundError) continue;
      record(result, { url, status: null, msg: `parseDetail: ${String(err)}` });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }

    try {
      await deps.persist.persistDetail(parsed);
    } catch (err) {
      record(result, { url, status: null, msg: `persist: ${String(err)}` });
      result.status = 'partial';
    }
    await publishProgress(deps, sweepId, result);
  }
}

function record(result: SweepResult, error: SweepError): void {
  result.errors.push(error);
}

function emptyResult(status: SweepStatus): SweepResult {
  return {
    status,
    pagesFetched: 0,
    detailsFetched: 0,
    newListings: 0,
    updatedListings: 0,
    errors: [],
    configSnapshot: null,
    pagesDetail: [],
    detailsDetail: [],
    eventLog: null,
  };
}

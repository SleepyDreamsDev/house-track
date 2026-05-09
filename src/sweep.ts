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

// Live count of detail fetches still pending in the current sweep. Incremented
// upfront when we know the work, decremented per fetch. Surfaced via
// GET /api/sweeps/:id so SweepDetail's "Queued" KStat shows real remaining
// work. Reset at sweep start so a crashed prior sweep can't leak a stale
// value into the next one.
let detailQueueDepth = 0;

export function getQueueDepth(): number {
  return detailQueueDepth;
}

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

/** Result envelope from the network callbacks. The crawler captures bytes
 *  for HTTP-forensics columns and attempts so the SweepDetail Errors tab
 *  can surface "this took 3 retries before giving up." */
export interface FetchEnvelope {
  json: unknown;
  bytes: number;
  attempts: number;
}

export interface SweepDeps {
  fetchSearchPage: (pageIdx: number, signal?: AbortSignal) => Promise<FetchEnvelope>;
  fetchAdvert: (id: string, signal?: AbortSignal) => Promise<FetchEnvelope>;
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
  detailQueueDepth = 0;
  const controller = new AbortController();
  sweepAbortControllers.set(sweepId, controller);
  const result: SweepResult = emptyResult('ok');

  try {
    // Capture config snapshot at sweep start (inside try so error triggers catch → finishSweep)
    result.configSnapshot = await deps.persist.snapshotConfig();
    const allStubs = await collectIndexStubs(deps, result, controller.signal, sweepId);
    const stubs = deps.applyPostFilter ? deps.applyPostFilter(allStubs) : allStubs;
    const diff = await deps.persist.diffAgainstDb(stubs);
    // Cap detail processing to targetListingsThisSweep — pagination's cap
    // only limits index pages, but a single page yields ~78 stubs which
    // (with seen-stub persist) costs 78×10s. Smoke needs an actual cap on
    // total fetches; full sweeps already have a high cap by config.
    const cap = deps.targetListingsThisSweep;
    let newStubs = diff.new;
    let seenStubs = diff.seen;
    if (cap !== undefined && newStubs.length + seenStubs.length > cap) {
      const newSlice = newStubs.slice(0, cap);
      const seenSlice = seenStubs.slice(0, Math.max(0, cap - newSlice.length));
      newStubs = newSlice;
      seenStubs = seenSlice;
    }
    result.newListings = newStubs.length;
    await publishProgress(deps, sweepId, result);

    await fetchAndPersistDetails(deps, newStubs, seenStubs, result, controller.signal, sweepId);
    await backfillUnenriched(deps, result, controller.signal, sweepId);

    await deps.persist.markSeen(seenStubs);
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
    detailQueueDepth = 0;
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
      pagesDetail: result.pagesDetail,
      detailsDetail: result.detailsDetail,
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
    const { json, bytes, attempts } = await deps.fetchSearchPage(page, signal); // CircuitTrippingError bubbles
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
        attempts,
      });
      result.status = 'partial';
      break;
    }
    const parseMs = Date.now() - parseStart;

    const pageDetail = {
      n: page,
      url: `<search-page-${page}>`,
      status: 200,
      bytes,
      attempts,
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

  // Seed the queue with total expected fetches; decrement per attempt so
  // the SweepDetail "Queued" KStat shows a real countdown.
  detailQueueDepth += newStubs.length + seenStubs.length;

  // Process new listings: fetch, parse, persist, and capture details
  for (const s of newStubs) {
    if (signal.aborted) {
      break;
    }
    detailQueueDepth = Math.max(0, detailQueueDepth - 1);
    setCurrentlyFetching(s.url);
    let envelope: FetchEnvelope;
    try {
      envelope = await deps.fetchAdvert(s.id, signal);
    } catch (err) {
      if (err instanceof CircuitTrippingError) throw err;
      record(result, { url: s.url, status: null, msg: String(err), attempts: attemptsOf(err) });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }
    const { json, bytes, attempts } = envelope;
    result.detailsFetched += 1;

    let parsed: ParsedDetail;
    const parseStart = Date.now();
    try {
      parsed = deps.parseDetail(s.id, json);
    } catch (err) {
      if (err instanceof AdvertNotFoundError) continue; // delisted between index and detail — not an error
      record(result, { url: s.url, status: null, msg: `parseDetail: ${String(err)}`, attempts });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }
    const parseMs = Date.now() - parseStart;

    const detailRecord = {
      id: s.id,
      url: s.url,
      status: 200,
      bytes,
      attempts,
      parseMs,
      action: 'new' as const,
      priceEur: parsed.priceEur ?? null,
    };
    result.detailsDetail.push(detailRecord);

    try {
      await deps.persist.persistDetail(parsed);
    } catch (err) {
      record(result, { url: s.url, status: null, msg: `persist: ${String(err)}`, attempts });
      result.status = 'partial';
    }
    await publishProgress(deps, sweepId, result);
  }

  // Re-fetch + persist seen listings so price/description changes accumulate
  // in ListingSnapshot. persistDetail is content-addressed (snapshot only on
  // rawHtmlHash change), so unchanged listings cost a row in detailsDetail
  // but no DB write — and the politeness budget paid for the fetch buys
  // actual price-history signal instead of being thrown away.
  for (const s of seenStubs) {
    if (signal.aborted) {
      break;
    }
    detailQueueDepth = Math.max(0, detailQueueDepth - 1);
    setCurrentlyFetching(s.url);
    let envelope: FetchEnvelope;
    try {
      envelope = await deps.fetchAdvert(s.id, signal);
    } catch (err) {
      if (err instanceof CircuitTrippingError) throw err;
      record(result, { url: s.url, status: null, msg: String(err), attempts: attemptsOf(err) });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }
    const { json, bytes, attempts } = envelope;

    let parsed: ParsedDetail;
    const parseStart = Date.now();
    try {
      parsed = deps.parseDetail(s.id, json);
    } catch (err) {
      if (err instanceof AdvertNotFoundError) continue; // delisted between index and detail — not an error
      record(result, { url: s.url, status: null, msg: `parseDetail: ${String(err)}`, attempts });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }
    const parseMs = Date.now() - parseStart;

    const detailRecord = {
      id: s.id,
      url: s.url,
      status: 200,
      bytes,
      attempts,
      parseMs,
      action: 'updated' as const,
      priceEur: parsed.priceEur ?? null,
    };
    result.detailsDetail.push(detailRecord);
    result.detailsFetched += 1;

    try {
      await deps.persist.persistDetail(parsed);
      result.updatedListings += 1;
    } catch (err) {
      record(result, { url: s.url, status: null, msg: `persist: ${String(err)}`, attempts });
      result.status = 'partial';
    }
    await publishProgress(deps, sweepId, result);
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
    let envelope: FetchEnvelope;
    try {
      envelope = await deps.fetchAdvert(id, signal);
    } catch (err) {
      if (err instanceof CircuitTrippingError) throw err;
      record(result, { url, status: null, msg: String(err), attempts: attemptsOf(err) });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }
    const { json, attempts } = envelope;
    result.detailsFetched += 1;

    let parsed: ParsedDetail;
    try {
      parsed = deps.parseDetail(id, json);
    } catch (err) {
      if (err instanceof AdvertNotFoundError) continue;
      record(result, { url, status: null, msg: `parseDetail: ${String(err)}`, attempts });
      result.status = 'partial';
      await publishProgress(deps, sweepId, result);
      continue;
    }

    try {
      await deps.persist.persistDetail(parsed);
    } catch (err) {
      record(result, { url, status: null, msg: `persist: ${String(err)}`, attempts });
      result.status = 'partial';
    }
    await publishProgress(deps, sweepId, result);
  }
}

// Fetcher annotates thrown errors with `.attempts`. Pull the value off
// without coupling sweep.ts to the Fetcher's specific error class. Falls
// back to 1 (single try) when the property is absent — matches the
// pre-instrumentation behavior.
function attemptsOf(err: unknown): number {
  if (
    err &&
    typeof err === 'object' &&
    typeof (err as { attempts?: unknown }).attempts === 'number'
  ) {
    return (err as { attempts: number }).attempts;
  }
  if (err instanceof CircuitTrippingError) return err.attempts;
  return 1;
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

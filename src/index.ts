// Cron entrypoint — one sweep per tick (hourly in production).
//
// Spec: docs/poc-spec.md §"Crawl flow (per sweep)".

import { PrismaClient } from '@prisma/client';
import { serve } from '@hono/node-server';
import cron from 'node-cron';

import { Circuit } from './circuit.js';
import { CIRCUIT, FILTER, GRAPHQL_ENDPOINT, POLITENESS, SWEEP } from './config.js';
import { Fetcher } from './fetch.js';
import {
  buildAdvertVariables,
  buildSearchVariables,
  GET_ADVERT_QUERY,
  SEARCH_ADS_QUERY,
} from './graphql.js';
import { log } from './log.js';
import { parseDetail } from './parse-detail.js';
import { applyPostFilter, parseIndex } from './parse-index.js';
import { Persistence } from './persist.js';
import { resolveActiveFilter } from './filter-resolver.js';
import { getSetting } from './settings.js';
import { runSweep, type SweepDeps } from './sweep.js';
import { createApiApp } from './web/server.js';

// Cron schedule + frequency are settings-driven at runtime; this is the
// fallback when no DB row exists. Default fires twice daily at 9am and 9pm.
const DEFAULT_SCHEDULE = '0 9,21 * * *';

// Module-scoped: PrismaClient holds a connection pool. Re-instantiating per tick
// leaks handles in a long-running cron process and can keep the event loop alive.
const prisma = new PrismaClient();

async function buildDeps(): Promise<SweepDeps> {
  const persist = new Persistence(prisma);
  const circuit = new Circuit({
    sentinelPath: CIRCUIT.sentinelPath,
    threshold: CIRCUIT.consecutiveFailureThreshold,
    pauseDurationMs: CIRCUIT.pauseDurationMs,
  });

  // Read runtime-mutable settings; fall back to defaults from config.ts
  const baseDelayMs = await getSetting('politeness.baseDelayMs', POLITENESS.baseDelayMs);
  const jitterMs = await getSetting('politeness.jitterMs', POLITENESS.jitterMs);
  const detailDelayMs = await getSetting('politeness.detailDelayMs', POLITENESS.detailDelayMs);
  const maxPagesPerSweep = await getSetting('sweep.maxPagesPerSweep', FILTER.maxPagesPerSweep);
  const backfillPerSweep = await getSetting('sweep.backfillPerSweep', SWEEP.backfillPerSweep);
  const targetMean = await getSetting('sweep.targetListingsPerSweep', SWEEP.targetListingsPerSweep);
  const targetJitter = await getSetting('sweep.targetListingsJitter', SWEEP.targetListingsJitter);
  const expectedPerDay = await getSetting('sweep.expectedPerDay', SWEEP.expectedPerDay);

  // Per-tick draw: each sweep gets a fresh random target so back-to-back
  // sweeps don't look identical in volume. Math.random() is fine — the
  // adversary (WAF pattern detection) can't see the seed.
  const targetListingsThisSweep =
    targetJitter > 0 ? targetMean + Math.floor((Math.random() * 2 - 1) * targetJitter) : targetMean;

  const missingThresholdMs =
    SWEEP.missingSweepsBeforeInactive * (24 / expectedPerDay) * 60 * 60 * 1000;

  const fetcher = new Fetcher({
    circuit,
    config: {
      baseDelayMs,
      jitterMs,
      retryBackoffsMs: POLITENESS.retryBackoffsMs,
      userAgent: POLITENESS.userAgent,
      acceptLanguage: POLITENESS.acceptLanguage,
      accept: POLITENESS.accept,
      acceptJson: POLITENESS.acceptJson,
      origin: POLITENESS.origin,
      referer: POLITENESS.referer,
    },
  });

  // Resolve the active filter once at sweep start; mid-sweep mutation is
  // intentionally out of scope (next tick picks up the change).
  const resolved = await resolveActiveFilter();
  const searchInputOverride = resolved.searchInput;
  const postFilterOverride = resolved.postFilter;

  return {
    fetchSearchPage: (pageIdx, signal) => {
      const opts = signal ? { signal } : {};
      return fetcher.fetchGraphQL(
        GRAPHQL_ENDPOINT,
        'SearchAds',
        buildSearchVariables(pageIdx, searchInputOverride),
        SEARCH_ADS_QUERY,
        opts,
      );
    },
    fetchAdvert: (id, signal) => {
      const opts = signal ? { delayMs: detailDelayMs, signal } : { delayMs: detailDelayMs };
      return fetcher.fetchGraphQL(
        GRAPHQL_ENDPOINT,
        'GetAdvert',
        buildAdvertVariables(id),
        GET_ADVERT_QUERY,
        opts,
      );
    },
    persist,
    circuit,
    parseIndex,
    parseDetail,
    applyPostFilter: (stubs) => applyPostFilter(stubs, postFilterOverride),
    maxPagesPerSweep,
    missingThresholdMs,
    backfillPerSweep,
    targetListingsThisSweep,
    log,
  };
}

async function tick(): Promise<void> {
  const deps = await buildDeps();
  try {
    await runSweep(deps);
  } catch (err) {
    log.error({ event: 'sweep.unhandled', err: String(err) });
  }
}

function bootstrap(): void {
  // RUN_ONCE is the smoke-test path: do one sweep, exit. No API or cron —
  // smoke doesn't read SSE and the listen would collide with a dev API.
  if (process.env['RUN_ONCE'] === '1') {
    log.info({ event: 'crawler.boot', mode: 'run_once' });
    void tick().then(() => process.exit(0));
    return;
  }

  const app = createApiApp();
  const port = 3000;
  const host = '127.0.0.1';

  serve(
    {
      fetch: app.fetch,
      port,
      hostname: host,
    },
    (info) => {
      log.info({ event: 'api.boot', address: info.address, port: info.port });
    },
  );

  // Schedule + jitter are read once at boot. Live mutation via the operator
  // UI requires a process restart — acceptable because changing cadence is
  // a deliberate operational decision, not a tunable knob.
  void (async () => {
    const schedule = await getSetting('sweep.cronSchedule', DEFAULT_SCHEDULE);
    const jitterMs = await getSetting('sweep.cronWindowJitterMs', SWEEP.cronWindowJitterMs);
    log.info({ event: 'crawler.boot', schedule, jitterMs });

    cron.schedule(schedule, () => {
      const offsetMs = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
      log.info({ event: 'tick.deferred', offsetMs });
      setTimeout(() => void tick(), offsetMs);
    });
  })();
}

bootstrap();

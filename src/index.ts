// Cron entrypoint — one sweep per tick (hourly in production).
//
// Spec: docs/poc-spec.md §"Crawl flow (per sweep)".

import { PrismaClient } from '@prisma/client';
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
import { getSetting } from './settings.js';
import { runSweep, type SweepDeps } from './sweep.js';

const SCHEDULE = process.env['CRON_SCHEDULE'] ?? '0 * * * *'; // top of every hour
const SWEEPS_PER_DAY = 24;
const MISSING_THRESHOLD_MS =
  SWEEP.missingSweepsBeforeInactive * (24 / SWEEPS_PER_DAY) * 60 * 60 * 1000;

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

  return {
    fetchSearchPage: (pageIdx) =>
      fetcher.fetchGraphQL(
        GRAPHQL_ENDPOINT,
        'SearchAds',
        buildSearchVariables(pageIdx),
        SEARCH_ADS_QUERY,
      ),
    fetchAdvert: (id) =>
      fetcher.fetchGraphQL(
        GRAPHQL_ENDPOINT,
        'GetAdvert',
        buildAdvertVariables(id),
        GET_ADVERT_QUERY,
        { delayMs: detailDelayMs },
      ),
    persist,
    circuit,
    parseIndex,
    parseDetail,
    applyPostFilter: (stubs) => applyPostFilter(stubs, FILTER.postFilter),
    maxPagesPerSweep,
    missingThresholdMs: MISSING_THRESHOLD_MS,
    backfillPerSweep,
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
  log.info({ event: 'crawler.boot', schedule: SCHEDULE });

  if (process.env['RUN_ONCE'] === '1') {
    void tick().then(() => process.exit(0));
    return;
  }

  cron.schedule(SCHEDULE, () => {
    void tick();
  });
}

bootstrap();

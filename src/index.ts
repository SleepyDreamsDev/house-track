// Cron entrypoint — one sweep per tick (hourly in production).
//
// Spec: docs/poc-spec.md §"Crawl flow (per sweep)".

import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';

import { Circuit } from './circuit.js';
import { CIRCUIT, FILTER, POLITENESS, SWEEP } from './config.js';
import { Fetcher } from './fetch.js';
import { log } from './log.js';
import { parseDetail } from './parse-detail.js';
import { parseIndex } from './parse-index.js';
import { Persistence } from './persist.js';
import { runSweep, type SweepDeps } from './sweep.js';

const SCHEDULE = process.env['CRON_SCHEDULE'] ?? '0 * * * *'; // top of every hour
const SWEEPS_PER_DAY = 24;
const MISSING_THRESHOLD_MS =
  SWEEP.missingSweepsBeforeInactive * (24 / SWEEPS_PER_DAY) * 60 * 60 * 1000;

function buildDeps(): SweepDeps {
  const prisma = new PrismaClient();
  const persist = new Persistence(prisma);
  const circuit = new Circuit({
    sentinelPath: CIRCUIT.sentinelPath,
    threshold: CIRCUIT.consecutiveFailureThreshold,
    pauseDurationMs: CIRCUIT.pauseDurationMs,
  });
  const fetcher = new Fetcher({
    circuit,
    config: {
      baseDelayMs: POLITENESS.baseDelayMs,
      jitterMs: POLITENESS.jitterMs,
      retryBackoffsMs: POLITENESS.retryBackoffsMs,
      userAgent: POLITENESS.userAgent,
      acceptLanguage: POLITENESS.acceptLanguage,
      accept: POLITENESS.accept,
    },
  });

  return {
    fetcher,
    persist,
    circuit,
    parseIndex,
    parseDetail,
    buildIndexUrl,
    maxPagesPerSweep: FILTER.maxPagesPerSweep,
    missingThresholdMs: MISSING_THRESHOLD_MS,
    log,
  };
}

function buildIndexUrl(page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(FILTER.params)) {
    if (typeof value === 'boolean') {
      if (value) params.set(key, '1');
    } else {
      params.set(key, String(value));
    }
  }
  params.set('page', String(page));
  return `${FILTER.baseUrl}?${params.toString()}`;
}

async function tick(): Promise<void> {
  const deps = buildDeps();
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

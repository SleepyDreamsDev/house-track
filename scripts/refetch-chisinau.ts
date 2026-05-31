// scripts/refetch-chisinau.ts
//
// One-off backfill: re-fetch the detail for every active, non-excluded
// Chișinău listing so existing rows pick up the structured zone (feature 9),
// which only arrives via a GetAdvert detail fetch. Reuses the crawler's exact
// fetch path and honors the same 10s detail politeness, one request at a time.
//
// POLITENESS: this is a second 999 request stream. Do NOT run it while a sweep
// is in progress — run it only in a quiet window between scheduled sweeps.
//
// Usage: node --env-file=.env --import tsx scripts/refetch-chisinau.ts

import { PrismaClient } from '@prisma/client';

import { Circuit } from '../src/circuit.js';
import { CIRCUIT, GRAPHQL_ENDPOINT, POLITENESS } from '../src/config.js';
import { Fetcher } from '../src/fetch.js';
import { buildAdvertVariables, GET_ADVERT_QUERY } from '../src/graphql.js';
import { AdvertNotFoundError, parseDetail } from '../src/parse-detail.js';
import { Persistence } from '../src/persist.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
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
      acceptJson: POLITENESS.acceptJson,
      origin: POLITENESS.origin,
      referer: POLITENESS.referer,
    },
  });

  const rows = await prisma.listing.findMany({
    where: { active: true, excluded: false, district: 'Chișinău' },
    select: { id: true },
    orderBy: { lastFetchedAt: 'asc' },
  });
  console.warn(
    `refetch-chisinau: ${rows.length} listings (~${Math.round((rows.length * 10) / 60)} min)`,
  );

  let ok = 0;
  let zoned = 0;
  let gone = 0;
  let failed = 0;
  for (const { id } of rows) {
    try {
      const envelope = await fetcher.fetchGraphQL(
        GRAPHQL_ENDPOINT,
        'GetAdvert',
        buildAdvertVariables(id),
        GET_ADVERT_QUERY,
        { delayMs: POLITENESS.detailDelayMs },
      );
      const detail = parseDetail(id, envelope.json);
      await persist.persistDetail(detail);
      ok += 1;
      if (detail.zone) zoned += 1;
    } catch (err) {
      if (err instanceof AdvertNotFoundError) gone += 1;
      else {
        failed += 1;
        console.error(`  ${id}: ${String(err)}`);
      }
    }
  }
  console.warn(`refetch-chisinau: done. ok=${ok} (zoned=${zoned}) gone=${gone} failed=${failed}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

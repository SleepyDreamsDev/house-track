// scripts/backfill-filter-ids.ts
//
// Updates pre-existing ListingFilterValue rows where filterId=0 to use the
// real filterId from the taxonomy LUT. Idempotent: re-running is a no-op
// once all rows are resolved.
//
// Usage:
//   pnpm backfill:filters [--dry-run]
//
// Reads bootstrap LUT from src/config.ts. When the captured taxonomy fixture
// lands at src/__tests__/fixtures/filter-taxonomy-response.json, the script
// merges its parsed LUT on top of the bootstrap.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

import {
  bootstrapLutFromConfig,
  mergeLuts,
  parseTaxonomyResponse,
  type TaxonomyLut,
} from '../src/parse-taxonomy.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAXONOMY_FIXTURE = join(REPO_ROOT, 'src/__tests__/fixtures/filter-taxonomy-response.json');

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const lut = await loadLut();

  console.error(`→ taxonomy LUT has ${lut.size} (featureId → filterId) entries`);
  if (lut.size === 0) {
    console.error('  no entries — nothing to backfill');
    return;
  }

  const prisma = new PrismaClient();
  try {
    let totalUpdated = 0;
    for (const [featureId, filterId] of lut) {
      const result = dryRun
        ? await prisma.listingFilterValue.count({ where: { featureId, filterId: 0 } })
        : (
            await prisma.listingFilterValue.updateMany({
              where: { featureId, filterId: 0 },
              data: { filterId },
            })
          ).count;
      if (result > 0) {
        console.error(
          `  ${dryRun ? 'would update' : 'updated'} featureId=${featureId} → filterId=${filterId}: ${result} rows`,
        );
        totalUpdated += result;
      }
    }
    console.error(`\n${dryRun ? '(dry-run) would update' : 'updated'} ${totalUpdated} rows total`);

    const stillUnresolved = await prisma.listingFilterValue.count({ where: { filterId: 0 } });
    console.error(
      `${stillUnresolved} rows still have filterId=0 (featureId not in LUT — capture taxonomy to resolve)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function loadLut(): Promise<TaxonomyLut> {
  const bootstrap = bootstrapLutFromConfig();
  if (!existsSync(TAXONOMY_FIXTURE)) {
    console.error(`(no captured taxonomy fixture at ${TAXONOMY_FIXTURE} — bootstrap only)`);
    return bootstrap;
  }
  const json = JSON.parse(await readFile(TAXONOMY_FIXTURE, 'utf8')) as unknown;
  const captured = parseTaxonomyResponse(json);
  console.error(
    `(merging ${captured.size} captured edges with ${bootstrap.size} bootstrap anchors)`,
  );
  return mergeLuts(bootstrap, captured);
}

main().catch((err: unknown) => {
  console.error(`✗ backfill failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

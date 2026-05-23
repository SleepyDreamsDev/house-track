// scripts/backfill-sectors.ts
// One-time/idempotent backfill: compute Listing.sector for Chișinău rows that
// don't have one yet. Safe to re-run. Usage: pnpm tsx scripts/backfill-sectors.ts
import { PrismaClient } from '@prisma/client';
import { deriveSector } from '../src/lib/chisinau-sector.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = await prisma.listing.findMany({
    where: { district: 'Chișinău', sector: null },
    select: { id: true, district: true, street: true, title: true, description: true },
  });
  let updated = 0;
  for (const r of rows) {
    const sector = deriveSector(r);
    if (sector) {
      await prisma.listing.update({ where: { id: r.id }, data: { sector } });
      updated += 1;
    }
  }
  console.warn(`backfill-sectors: examined ${rows.length}, classified ${updated}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

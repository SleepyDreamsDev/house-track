// scripts/backfill-sectors.ts
// Idempotent backfill: RE-derive Listing.sector for every Chișinău row from its
// stored street/title/description. Re-derives (not just fills nulls) so a change
// to the zone heuristic — e.g. de-collapsing Telecentru/Sculeni — corrects
// existing rows without waiting for each listing to be re-fetched. Safe to
// re-run. Usage: node --env-file=.env --import tsx scripts/backfill-sectors.ts
import { PrismaClient } from '@prisma/client';
import { deriveSector } from '../src/lib/chisinau-sector.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = await prisma.listing.findMany({
    where: { district: 'Chișinău' },
    select: {
      id: true,
      district: true,
      street: true,
      title: true,
      description: true,
      sector: true,
    },
  });
  let updated = 0;
  const tally = new Map<string, number>();
  for (const r of rows) {
    const sector = deriveSector(r);
    tally.set(sector ?? '∅', (tally.get(sector ?? '∅') ?? 0) + 1);
    if (sector !== r.sector) {
      await prisma.listing.update({ where: { id: r.id }, data: { sector } });
      updated += 1;
    }
  }
  const dist = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join('  ');
  console.warn(`backfill-sectors: examined ${rows.length}, changed ${updated}`);
  console.warn(`distribution → ${dist}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

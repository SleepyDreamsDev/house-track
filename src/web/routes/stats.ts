// Stats endpoints powering Dashboard widgets.
//
// STATUS: stubs. Replace each with real Prisma queries — TODO blocks below
// have the SQL sketches.

import { Hono } from 'hono';
// import { prisma } from '../../db.js';

export const statsRouter = new Hono();

// GET /api/stats/by-district
// Returns district name, active count, and avg €/m² for active listings.
statsRouter.get('/stats/by-district', async (c) => {
  // TODO (Claude Code, Task 3): real query
  // const rows = await prisma.$queryRaw<DistrictRow[]>`
  //   SELECT district AS name,
  //          COUNT(*)::int AS count,
  //          ROUND(AVG("priceEur" / NULLIF("areaSqm", 0)))::int AS "eurPerSqm"
  //   FROM "Listing"
  //   WHERE "deletedAt" IS NULL
  //   GROUP BY district
  //   ORDER BY count DESC
  // `;
  // return c.json(rows);

  return c.json([
    { name: 'Buiucani', count: 89, eurPerSqm: 1320 },
    { name: 'Botanica', count: 64, eurPerSqm: 1180 },
    { name: 'Centru', count: 42, eurPerSqm: 1850 },
    { name: 'Ciocana', count: 38, eurPerSqm: 1090 },
    { name: 'Durlești', count: 12, eurPerSqm: 920 },
    { name: 'Râșcani', count: 2, eurPerSqm: 1140 },
  ]);
});

// GET /api/stats/new-per-day
// Returns last 7 days of new-listing counts (oldest first).
statsRouter.get('/stats/new-per-day', async (c) => {
  // TODO (Claude Code, Task 3): real query
  // SELECT date_trunc('day', "firstSeenAt") AS d, COUNT(*)::int
  //   FROM "Listing"
  //  WHERE "firstSeenAt" >= NOW() - INTERVAL '7 days'
  //  GROUP BY 1 ORDER BY 1 ASC
  return c.json([8, 12, 5, 9, 14, 7, 11]);
});

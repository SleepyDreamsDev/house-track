// Stats endpoints powering Dashboard widgets.

import { Hono } from 'hono';
import { getPrisma } from '../../db.js';

export const statsRouter = new Hono();

interface DistrictRow {
  name: string;
  count: number;
  eurPerSqm: number;
}

// GET /api/stats/by-district
// Returns district name, active count, and avg €/m² for active listings.
statsRouter.get('/stats/by-district', async (c) => {
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<DistrictRow[]>`
    SELECT "district" AS name,
           COUNT(*)::int AS count,
           ROUND(AVG("priceEur" / NULLIF("areaSqm", 0)))::int AS "eurPerSqm"
    FROM "Listing"
    WHERE "active" = true AND "district" IS NOT NULL
    GROUP BY "district"
    ORDER BY count DESC
  `;
  return c.json(rows);
});

// GET /api/stats/new-per-day
// Returns last 7 days of new-listing counts (oldest first).
statsRouter.get('/stats/new-per-day', async (c) => {
  const prisma = getPrisma();

  // Get 7 days of data with all days present
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Query data for last 7 days
  const rows = await prisma.$queryRaw<Array<{ d: Date; count: bigint }>>`
    SELECT date_trunc('day', "firstSeenAt") AS d, COUNT(*)::int AS count
    FROM "Listing"
    WHERE "firstSeenAt" >= ${sevenDaysAgo} AND "active" = true
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  // Build result array with 7 days, padding missing days with 0
  const resultMap = new Map<string, number>();
  for (const row of rows) {
    const date = row.d instanceof Date ? row.d : new Date(row.d);
    const dayKey = date.toISOString().split('T')[0] ?? '';
    if (dayKey) {
      resultMap.set(dayKey, Number(row.count));
    }
  }

  const result: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dayKey = date.toISOString().split('T')[0] ?? '';
    result.push(resultMap.get(dayKey) ?? 0);
  }

  return c.json(result);
});

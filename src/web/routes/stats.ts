// Stats endpoints powering Dashboard widgets.

import { Hono } from 'hono';
import { getPrisma } from '../../db.js';
import { getSetting } from '../../settings.js';

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

  // Build result array with 7 days, padding missing days with 0.
  // Use UTC-day arithmetic on both sides — DB buckets via date_trunc('day')
  // in UTC and Date.setDate() mutates by *local* calendar days, which would
  // skew the window by one day at the midnight-local boundary.
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
    date.setUTCDate(date.getUTCDate() - i);
    const dayKey = date.toISOString().split('T')[0] ?? '';
    result.push(resultMap.get(dayKey) ?? 0);
  }

  return c.json(result);
});

// GET /api/stats/success-rate
// Returns the fraction of finished SweepRuns with status='ok' over the most
// recent `stats.successRateWindow` finished runs (default 100). Powers the
// Dashboard "Sweep success" KPI tile.
statsRouter.get('/stats/success-rate', async (c) => {
  const window = await getSetting<number>('stats.successRateWindow', 100);
  const prisma = getPrisma();
  const recent = await prisma.sweepRun.findMany({
    where: { finishedAt: { not: null } },
    orderBy: { startedAt: 'desc' },
    take: window,
    select: { status: true },
  });
  const total = recent.length;
  const ok = recent.filter((r) => r.status === 'ok').length;
  const rate = total > 0 ? ok / total : 0;
  return c.json({ rate, ok, total, window });
});

// GET /api/stats/avg-price
// Returns the mean priceEur across active listings with non-null priceEur.
// Powers the Dashboard "Avg price" KPI tile.
statsRouter.get('/stats/avg-price', async (c) => {
  const prisma = getPrisma();
  const result = await prisma.listing.aggregate({
    where: { active: true, priceEur: { not: null } },
    _avg: { priceEur: true },
    _count: { _all: true },
  });
  const avgPrice = result._avg.priceEur != null ? Math.round(result._avg.priceEur) : 0;
  return c.json({ avgPrice, count: result._count._all });
});

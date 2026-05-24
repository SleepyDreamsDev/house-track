import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { searchListings, getListing } from '../../mcp/queries.js';
import { Persistence } from '../../persist.js';
import { deriveType } from '../../lib/listing-type.js';
import { classifyListing } from '../../lib/listing-classification.js';

export function registerListingsRoutes(app: Hono, prisma: PrismaClient): void {
  app.get('/api/listings', async (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const offsetRaw = c.req.query('offset');
    const offset = offsetRaw ? Math.max(0, parseInt(offsetRaw)) : undefined;
    const minPrice = c.req.query('minPrice') ? parseInt(c.req.query('minPrice')!) : undefined;
    const maxPrice = c.req.query('maxPrice') ? parseInt(c.req.query('maxPrice')!) : undefined;
    const minRooms = c.req.query('minRooms') ? parseInt(c.req.query('minRooms')!) : undefined;
    const maxRooms = c.req.query('maxRooms') ? parseInt(c.req.query('maxRooms')!) : undefined;
    const minAreaSqm = c.req.query('minAreaSqm')
      ? parseFloat(c.req.query('minAreaSqm')!)
      : undefined;
    const maxAreaSqm = c.req.query('maxAreaSqm')
      ? parseFloat(c.req.query('maxAreaSqm')!)
      : undefined;
    // Accept `?district=A,B` and `?district=A&district=B`. Reject the
    // present-but-empty shape (`?district=`, `?district=,,,`, `?district=%20`)
    // with 400 — otherwise it silently widens to "all districts" and masks
    // an operator-side bug.
    const districtParams = c.req.queries('district');
    let district: string | undefined;
    if (districtParams !== undefined) {
      const parts = districtParams
        .flatMap((raw) => raw.split(','))
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        return c.json({ error: 'district query parameter is empty or whitespace-only' }, 400);
      }
      district = parts.join(',');
    }
    const sectorParams = c.req.queries('sector');
    let sector: string | undefined;
    if (sectorParams !== undefined) {
      const parts = sectorParams
        .flatMap((raw) => raw.split(','))
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        return c.json({ error: 'sector query parameter is empty or whitespace-only' }, 400);
      }
      sector = parts.join(',');
    }
    const sort = c.req.query('sort') as 'newest' | 'price' | 'eurm2' | undefined;
    const type = c.req.query('type') || undefined;
    const q = c.req.query('q');
    const flags = c.req.query('flags');
    const firstSeenAfter = c.req.query('firstSeenAfter');
    const lastFetchedAfter = c.req.query('lastFetchedAfter');
    const favorite = c.req.query('favorite') === 'true' ? true : undefined;
    const includeExcluded = c.req.query('includeExcluded') === 'true' ? true : undefined;

    const results = await searchListings(prisma, {
      limit,
      offset,
      minPrice,
      maxPrice,
      minRooms,
      maxRooms,
      minAreaSqm,
      maxAreaSqm,
      district,
      sector,
      sort,
      type,
      q,
      flags,
      firstSeenAfter,
      lastFetchedAfter,
      favorite,
      includeExcluded,
    });

    return c.json(results);
  });

  // Observed-data facets for the Listings page filter rail. Districts come
  // from distinct Listing.district values; price/rooms/area ranges come from
  // min/max over active listings. Hardcoding these in the UI drifts as the
  // catalog evolves — sourcing from the DB keeps the rail accurate.
  app.get('/api/listings/facets', async (c) => {
    const districtRows = await prisma.listing.findMany({
      where: { active: true, excluded: false, district: { not: null } },
      distinct: ['district'],
      select: { district: true },
      orderBy: { district: 'asc' },
    });
    const districts = districtRows.map((r) => r.district).filter((d): d is string => d !== null);

    const aggregates = await prisma.listing.aggregate({
      where: { active: true, excluded: false },
      _min: { priceEur: true, rooms: true, areaSqm: true },
      _max: { priceEur: true, rooms: true, areaSqm: true },
      _count: true,
    });

    // Dedupe titles at the DB level — deriveType is a JS regex over title
    // (no clean SQL translation for the Romanian "vilă" diacritic), so we
    // must read titles, but distinct titles bounds the row count regardless
    // of catalog size. Then bucket in memory.
    const titleRows = await prisma.listing.findMany({
      where: { active: true, excluded: false },
      distinct: ['title'],
      select: { title: true },
    });
    const types = Array.from(new Set(titleRows.map((r) => deriveType(r.title)))).sort();

    const roomsRows = await prisma.listing.findMany({
      where: { active: true, excluded: false, rooms: { not: null } },
      distinct: ['rooms'],
      select: { rooms: true },
      orderBy: { rooms: 'asc' },
    });
    const roomsValues = roomsRows.map((r) => r.rooms).filter((r): r is number => r !== null);

    const sectorRows = await prisma.listing.groupBy({
      by: ['sector'],
      where: { active: true, excluded: false, sector: { not: null } },
      _count: { _all: true },
    });
    const sectors = sectorRows
      .map((r) => ({ name: r.sector as string, count: r._count._all }))
      .sort((a, b) => b.count - a.count);

    // Counts backing the rail's boolean toggles. The unified FilterRail hides a
    // toggle when its count is 0 ("no data in current view"): no favorites → no
    // Favorites toggle, no excluded rows → no Show-excluded toggle, etc.
    const favoritesCount = await prisma.listing.count({
      where: { active: true, excluded: false, watchlist: true },
    });
    const excludedCount = await prisma.listing.count({
      where: { active: true, excluded: true },
    });
    // mislabeledCount needs classifyListing (JS regex over title/description +
    // a region allowlist) — no clean SQL form. Bounded by the active catalog
    // size, so reading these three columns and classifying in memory is cheap.
    const mislabelRows = await prisma.listing.findMany({
      where: { active: true, excluded: false },
      select: { title: true, description: true, district: true },
    });
    const mislabeledCount = mislabelRows.filter((r) => {
      const cls = classifyListing(r);
      return cls.typeMismatch || cls.regionMismatch;
    }).length;

    return c.json({
      total: aggregates._count,
      districts,
      ...(sectors.length > 0 ? { sectors } : {}),
      price: { min: aggregates._min.priceEur, max: aggregates._max.priceEur },
      rooms: { min: aggregates._min.rooms, max: aggregates._max.rooms },
      areaSqm: { min: aggregates._min.areaSqm, max: aggregates._max.areaSqm },
      types,
      roomsValues,
      favoritesCount,
      excludedCount,
      mislabeledCount,
    });
  });

  app.get('/api/listings/:id', async (c) => {
    const id = c.req.param('id');
    const result = await getListing(prisma, id);

    if (!result) {
      return c.json({ error: 'Listing not found' }, 404);
    }

    return c.json(result);
  });

  // Toggle the operator's "always refresh me first" flag for one listing.
  // Body: { watchlist: boolean }. The crawler reads Listing.watchlist in
  // findStaleListings, prioritizing flagged rows in every sweep regardless
  // of how recently lastFetchedAt was bumped.
  app.put('/api/listings/:id/watchlist', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as { watchlist?: unknown } | null;
    if (!body || typeof body.watchlist !== 'boolean') {
      return c.json({ error: 'Body must be { watchlist: boolean }' }, 400);
    }
    const persist = new Persistence(prisma);
    try {
      await persist.setWatchlist(id, body.watchlist);
    } catch {
      return c.json({ error: 'Listing not found' }, 404);
    }
    return c.json({ id, watchlist: body.watchlist });
  });

  // Freeze a listing the operator isn't interested in: excluded rows are
  // dropped from every sweep's detail re-fetch (saving the politeness budget)
  // and hidden from the default Listings view + facets. Reversible — set false
  // to resume tracking. Body: { excluded: boolean }.
  app.put('/api/listings/:id/excluded', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as { excluded?: unknown } | null;
    if (!body || typeof body.excluded !== 'boolean') {
      return c.json({ error: 'Body must be { excluded: boolean }' }, 400);
    }
    const persist = new Persistence(prisma);
    try {
      await persist.setExcluded(id, body.excluded);
    } catch {
      return c.json({ error: 'Listing not found' }, 404);
    }
    return c.json({ id, excluded: body.excluded });
  });
}

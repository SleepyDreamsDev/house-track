import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { searchListings, getListing } from '../../mcp/queries.js';
import { Persistence } from '../../persist.js';
import { deriveType } from '../../lib/listing-type.js';

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
    const district = c.req.query('district');
    const sort = c.req.query('sort') as 'newest' | 'price' | 'eurm2' | undefined;
    const q = c.req.query('q');
    const flags = c.req.query('flags');
    const firstSeenAfter = c.req.query('firstSeenAfter');
    const lastFetchedAfter = c.req.query('lastFetchedAfter');

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
      sort,
      q,
      flags,
      firstSeenAfter,
      lastFetchedAfter,
    });

    return c.json(results);
  });

  // Observed-data facets for the Listings page filter rail. Districts come
  // from distinct Listing.district values; price/rooms/area ranges come from
  // min/max over active listings. Hardcoding these in the UI drifts as the
  // catalog evolves — sourcing from the DB keeps the rail accurate.
  app.get('/api/listings/facets', async (c) => {
    const districtRows = await prisma.listing.findMany({
      where: { active: true, district: { not: null } },
      distinct: ['district'],
      select: { district: true },
      orderBy: { district: 'asc' },
    });
    const districts = districtRows.map((r) => r.district).filter((d): d is string => d !== null);

    const aggregates = await prisma.listing.aggregate({
      where: { active: true },
      _min: { priceEur: true, rooms: true, areaSqm: true },
      _max: { priceEur: true, rooms: true, areaSqm: true },
      _count: true,
    });

    // Dedupe titles at the DB level — deriveType is a JS regex over title
    // (no clean SQL translation for the Romanian "vilă" diacritic), so we
    // must read titles, but distinct titles bounds the row count regardless
    // of catalog size. Then bucket in memory.
    const titleRows = await prisma.listing.findMany({
      where: { active: true },
      distinct: ['title'],
      select: { title: true },
    });
    const types = Array.from(new Set(titleRows.map((r) => deriveType(r.title)))).sort();

    const roomsRows = await prisma.listing.findMany({
      where: { active: true, rooms: { not: null } },
      distinct: ['rooms'],
      select: { rooms: true },
      orderBy: { rooms: 'asc' },
    });
    const roomsValues = roomsRows.map((r) => r.rooms).filter((r): r is number => r !== null);

    return c.json({
      total: aggregates._count,
      districts,
      price: { min: aggregates._min.priceEur, max: aggregates._max.priceEur },
      rooms: { min: aggregates._min.rooms, max: aggregates._max.rooms },
      areaSqm: { min: aggregates._min.areaSqm, max: aggregates._max.areaSqm },
      types,
      roomsValues,
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
}

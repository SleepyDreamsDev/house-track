import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { searchListings, getListing, getPriceHistory } from '../../mcp/queries.js';
import { Persistence } from '../../persist.js';
import { deriveType } from '../../lib/listing-type.js';
import { classifyListing, isMunicipalityLocality } from '../../lib/listing-classification.js';
import { optFloat, optInt } from '../params.js';
import { fitHedonic, residualPct, type HedonicSample } from '../../lib/hedonic.js';
import { districtDomMedians, VALUATION_MIN_SAMPLES } from './analytics.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function registerListingsRoutes(app: Hono, prisma: PrismaClient): void {
  app.get('/api/listings', async (c) => {
    const limit = optInt(c.req.query('limit')) ?? 50;
    const offsetParsed = optInt(c.req.query('offset'));
    const offset = offsetParsed !== undefined ? Math.max(0, offsetParsed) : undefined;
    const minPrice = optInt(c.req.query('minPrice'));
    const maxPrice = optInt(c.req.query('maxPrice'));
    const minRooms = optInt(c.req.query('minRooms'));
    const maxRooms = optInt(c.req.query('maxRooms'));
    const minAreaSqm = optFloat(c.req.query('minAreaSqm'));
    const maxAreaSqm = optFloat(c.req.query('maxAreaSqm'));
    const minLandAre = optFloat(c.req.query('minLandAre'));
    const maxLandAre = optFloat(c.req.query('maxLandAre'));
    const minFloors = optInt(c.req.query('minFloors'));
    const maxFloors = optInt(c.req.query('maxFloors'));
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
      minLandAre,
      maxLandAre,
      minFloors,
      maxFloors,
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
    // Observed districts that belong to the Chișinău municipality. The rail's
    // "Chișinău (municipality)" group expands to exactly these — sending the
    // real district strings keeps the query a plain exact-match `IN (...)`.
    const municipality = districts.filter((d) => isMunicipalityLocality(d));

    const aggregates = await prisma.listing.aggregate({
      where: { active: true, excluded: false },
      _min: { priceEur: true, rooms: true, areaSqm: true, landAre: true, floors: true },
      _max: { priceEur: true, rooms: true, areaSqm: true, landAre: true, floors: true },
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
      ...(municipality.length > 0 ? { municipality } : {}),
      ...(sectors.length > 0 ? { sectors } : {}),
      price: { min: aggregates._min.priceEur, max: aggregates._max.priceEur },
      rooms: { min: aggregates._min.rooms, max: aggregates._max.rooms },
      areaSqm: { min: aggregates._min.areaSqm, max: aggregates._max.areaSqm },
      landAre: { min: aggregates._min.landAre, max: aggregates._max.landAre },
      floors: { min: aggregates._min.floors, max: aggregates._max.floors },
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

  // Negotiation dossier: everything the operator needs before contacting a
  // seller — exposure vs the district, model-implied fair price, the seller's
  // other inventory, and any duplicate/relisted copies of the same property.
  app.get('/api/listings/:id/dossier', async (c) => {
    const id = c.req.param('id');
    const listing = await prisma.listing.findUnique({ where: { id } });
    if (!listing) {
      return c.json({ error: 'Listing not found' }, 404);
    }

    const now = new Date();
    const activeDOM = Math.max(
      0,
      Math.floor((now.getTime() - listing.firstSeenAt.getTime()) / DAY_MS),
    );

    // Active non-excluded slice powers both the district DOM median and the
    // hedonic fit — same per-request idiom as /analytics/valuation.
    const slice = await prisma.listing.findMany({
      where: { active: true, excluded: false },
      select: {
        title: true,
        priceEur: true,
        areaSqm: true,
        rooms: true,
        yearBuilt: true,
        district: true,
        sector: true,
        heatingType: true,
        firstSeenAt: true,
      },
    });

    const domMedians = districtDomMedians(slice, now);
    const domMedianDistrict = listing.district ? (domMedians.get(listing.district) ?? null) : null;

    const toSample = (r: {
      title: string;
      priceEur: number | null;
      areaSqm: number | null;
      rooms: number | null;
      yearBuilt: number | null;
      sector: string | null;
      heatingType: string | null;
    }): HedonicSample => ({
      priceEur: r.priceEur,
      areaSqm: r.areaSqm,
      rooms: r.rooms,
      yearBuilt: r.yearBuilt,
      sector: r.sector,
      heatingType: r.heatingType,
      type: deriveType(r.title),
    });
    const model = fitHedonic(slice.map(toSample));
    let hedonic: { predictedEur: number; residualPct: number } | null = null;
    if (
      model != null &&
      model.n >= VALUATION_MIN_SAMPLES &&
      listing.priceEur != null &&
      listing.areaSqm != null &&
      listing.areaSqm > 0
    ) {
      const predicted = model.predict(toSample(listing));
      if (predicted != null && predicted > 0) {
        hedonic = {
          predictedEur: Math.round(predicted),
          residualPct: Math.round(residualPct(listing.priceEur, predicted) * 1000) / 1000,
        };
      }
    }

    const memberSelect = {
      id: true,
      url: true,
      title: true,
      priceEur: true,
      active: true,
      delistedAt: true,
    } as const;

    const authorListings = listing.authorId
      ? await prisma.listing.findMany({
          where: { authorId: listing.authorId, id: { not: id } },
          select: memberSelect,
          orderBy: { firstSeenAt: 'desc' },
        })
      : [];

    // Cluster membership includes delisted siblings — they ARE the relist
    // story. No active filter on purpose.
    const canonicalId = listing.canonicalId ?? listing.id;
    const members = await prisma.listing.findMany({
      where: {
        OR: [{ canonicalId }, { id: canonicalId }],
        id: { not: id },
      },
      select: { ...memberSelect, firstSeenAt: true },
      orderBy: { firstSeenAt: 'asc' },
    });
    const cluster = members.length > 0 ? { canonicalId, members } : null;

    return c.json({
      activeDOM,
      domMedianDistrict,
      hedonic,
      postedAt: listing.postedAt,
      bumpedAt: listing.bumpedAt,
      authorName: listing.authorName,
      authorListings,
      cluster,
    });
  });

  app.get('/api/listings/:id/price-history', async (c) => {
    const id = c.req.param('id');
    const points = await getPriceHistory(prisma, id);
    if (points === null) {
      return c.json({ error: 'Listing not found' }, 404);
    }
    return c.json({ points });
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

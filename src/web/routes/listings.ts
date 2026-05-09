import type { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { searchListings, getListing } from '../../mcp/queries.js';

export function registerListingsRoutes(app: Hono, prisma: PrismaClient): void {
  app.get('/api/listings', async (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
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

    const results = await searchListings(prisma, {
      limit,
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
    });

    return c.json(results);
  });

  app.get('/api/listings/:id', async (c) => {
    const id = c.req.param('id');
    const result = await getListing(prisma, id);

    if (!result) {
      return c.json({ error: 'Listing not found' }, 404);
    }

    return c.json(result);
  });
}

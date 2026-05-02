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

    const results = await searchListings(prisma, {
      limit,
      minPrice,
      maxPrice,
      minRooms,
      maxRooms,
      minAreaSqm,
      maxAreaSqm,
      district,
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

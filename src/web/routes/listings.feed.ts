// Dashboard "leads" feeds — what showed up today, what dropped in price.

import { Hono } from 'hono';
// import { prisma } from '../../db.js';

export const listingsFeedRouter = new Hono();

// GET /api/listings/new-today
// Listings whose firstSeenAt is within the last 24h.
listingsFeedRouter.get('/listings/new-today', async (c) => {
  // TODO (Claude Code, Task 3): real query
  // const rows = await prisma.listing.findMany({
  //   where: { firstSeenAt: { gte: new Date(Date.now() - 24*60*60*1000) }, deletedAt: null },
  //   orderBy: { firstSeenAt: 'desc' },
  //   take: 10,
  // });
  // return c.json(rows);

  const now = Date.now();
  return c.json([
    {
      id: 'h-91445',
      title: 'Casă, 130 m², Buiucani · str. Ion Creangă',
      priceEur: 145_000,
      areaSqm: 130,
      rooms: 4,
      district: 'Buiucani',
      street: 'str. Ion Creangă',
      firstSeenAt: new Date(now - 12 * 60_000).toISOString(),
      isNew: true,
    },
    {
      id: 'h-91442',
      title: 'Casă cu teren, 200 m², Botanica',
      priceEur: 198_000,
      areaSqm: 200,
      landSqm: 600,
      rooms: 5,
      district: 'Botanica',
      firstSeenAt: new Date(now - 47 * 60_000).toISOString(),
      isNew: true,
    },
  ]);
});

// GET /api/listings/price-drops
// Listings with ≥5% price drop in the last 7 days.
listingsFeedRouter.get('/listings/price-drops', async (c) => {
  // TODO (Claude Code, Task 3): real query
  // Compare latest snapshot priceEur vs earliest snapshot priceEur in last 7d;
  // include where ratio <= 0.95.
  const now = Date.now();
  return c.json([
    {
      id: 'h-91204',
      title: 'Casă, 145 m², Ciocana',
      priceEur: 132_000,
      priceWas: 148_000,
      areaSqm: 145,
      rooms: 4,
      district: 'Ciocana',
      firstSeenAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
      priceDrop: true,
    },
  ]);
});

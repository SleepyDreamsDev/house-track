// Dashboard "leads" feeds — what showed up today, what dropped in price.

import { Hono } from 'hono';
import { getPrisma } from '../../db.js';

export const listingsFeedRouter = new Hono();

interface NewTodayListing {
  id: string;
  title: string;
  priceEur: number | null;
  areaSqm: number | null;
  rooms: number | null;
  landSqm?: number | null;
  district: string | null;
  street?: string | null;
  firstSeenAt: string;
  isNew: boolean;
}

interface PriceDropListing {
  id: string;
  title: string;
  priceEur: number | null;
  priceWas: number | null;
  areaSqm: number | null;
  rooms: number | null;
  district: string | null;
  firstSeenAt: string;
  priceDrop: boolean;
}

// GET /api/listings/new-today
// Listings whose firstSeenAt is within the last 24h.
listingsFeedRouter.get('/listings/new-today', async (c) => {
  const prisma = getPrisma();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const listings = await prisma.listing.findMany({
    where: {
      firstSeenAt: { gte: oneDayAgo },
      active: true,
    },
    orderBy: { firstSeenAt: 'desc' },
    take: 10,
    select: {
      id: true,
      title: true,
      priceEur: true,
      areaSqm: true,
      rooms: true,
      landSqm: true,
      district: true,
      street: true,
      firstSeenAt: true,
    },
  });

  const result: NewTodayListing[] = listings.map((listing) => ({
    id: listing.id,
    title: listing.title,
    priceEur: listing.priceEur,
    areaSqm: listing.areaSqm,
    rooms: listing.rooms,
    landSqm: listing.landSqm,
    district: listing.district,
    street: listing.street,
    firstSeenAt: listing.firstSeenAt.toISOString(),
    isNew: true,
  }));

  return c.json(result);
});

// GET /api/listings/price-drops
// Listings with ≥5% price drop in the last 7 days.
listingsFeedRouter.get('/listings/price-drops', async (c) => {
  const prisma = getPrisma();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Find listings with snapshots in last 7 days
  const listings = await prisma.listing.findMany({
    where: { active: true },
    select: {
      id: true,
      title: true,
      priceEur: true,
      areaSqm: true,
      rooms: true,
      district: true,
      firstSeenAt: true,
      snapshots: {
        where: { capturedAt: { gte: sevenDaysAgo } },
        orderBy: { capturedAt: 'asc' },
      },
    },
  });

  const result: PriceDropListing[] = [];

  for (const listing of listings) {
    // Need at least 2 snapshots to calculate a drop
    if (listing.snapshots.length < 2) continue;

    const earliest = listing.snapshots.at(0);
    const latest = listing.snapshots.at(-1);

    // Only consider if we have both snapshots with prices
    if (!earliest || !latest || earliest.priceEur === null || latest.priceEur === null) {
      continue;
    }

    // Calculate drop percentage
    const dropRatio = latest.priceEur / earliest.priceEur;

    // Include if >= 5% drop (ratio <= 0.95)
    if (dropRatio <= 0.95) {
      result.push({
        id: listing.id,
        title: listing.title,
        priceEur: latest.priceEur,
        priceWas: earliest.priceEur,
        areaSqm: listing.areaSqm,
        rooms: listing.rooms,
        district: listing.district,
        firstSeenAt: listing.firstSeenAt.toISOString(),
        priceDrop: true,
      });
    }
  }

  return c.json(result);
});

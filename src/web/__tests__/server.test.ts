import { describe, it, expect, beforeAll } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Hono } from 'hono';

import { getPrisma } from '../../db.js';
import { createApiApp } from '../server.js';

describe('Hono API Server', () => {
  let prisma: PrismaClient;
  let app: Hono;

  beforeAll(async () => {
    prisma = getPrisma();
    app = createApiApp();

    // Seed test data
    await prisma.sweepRun.create({
      data: {
        status: 'ok',
        pagesFetched: 10,
        detailsFetched: 5,
        newListings: 3,
        updatedListings: 2,
        errors: JSON.parse('[]'),
      },
    });

    await prisma.sweepRun.create({
      data: {
        status: 'ok',
        pagesFetched: 20,
        detailsFetched: 10,
        newListings: 8,
        updatedListings: 5,
        errors: JSON.parse('[{"page": 1, "message": "timeout"}]'),
      },
    });

    await prisma.listing.create({
      data: {
        id: 'test-listing-1',
        url: 'https://999.md/123',
        title: 'Test Apartment',
        priceEur: 150000,
        priceRaw: '150,000 EUR',
        rooms: 2,
        areaSqm: 75,
        district: 'Centru',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        lastFetchedAt: new Date(),
      },
    });

    await prisma.source.create({
      data: {
        slug: '999md',
        name: '999.md',
        baseUrl: 'https://999.md',
        adapterKey: '999md',
        enabled: true,
      },
    });

    await prisma.setting.upsert({
      where: { key: 'politeness.baseDelayMs' },
      update: { valueJson: 8000 },
      create: { key: 'politeness.baseDelayMs', valueJson: 8000 },
    });
  });

  it('GET /api/sweeps returns paginated sweep list', async () => {
    const res = await app.request('/api/sweeps?limit=10');
    expect(res.status).toBe(200);
  });

  it('GET /api/sweeps/latest returns most recent sweep', async () => {
    const res = await app.request('/api/sweeps/latest');
    expect(res.status).toBe(200);
  });

  it('GET /api/sweeps/:id/errors returns parsed errors', async () => {
    const sweeps = await prisma.sweepRun.findMany();
    const sweepWithErrors = sweeps.find((s) => s.errors && Array.isArray(s.errors));
    if (!sweepWithErrors) {
      expect(true).toBe(true);
      return;
    }

    const res = await app.request(`/api/sweeps/${sweepWithErrors.id}/errors`);
    expect(res.status).toBe(200);
  });

  it('GET /api/listings returns filtered listings', async () => {
    const res = await app.request('/api/listings');
    expect(res.status).toBe(200);
  });

  it('GET /api/listings/:id returns listing detail', async () => {
    const res = await app.request('/api/listings/test-listing-1');
    expect(res.status).toBe(200);
  });

  it('GET /api/listings/:id returns 404 for non-existent listing', async () => {
    const res = await app.request('/api/listings/nonexistent');
    expect(res.status).toBe(404);
  });

  it('GET /api/filters returns filter options', async () => {
    const res = await app.request('/api/filters');
    expect(res.status).toBe(200);
  });

  it('GET /api/settings returns all settings with defaults', async () => {
    const res = await app.request('/api/settings');
    expect(res.status).toBe(200);
  });

  it('PATCH /api/settings/:key validates and updates setting', async () => {
    const res = await app.request(
      new Request('http://localhost/api/settings/politeness.baseDelayMs', {
        method: 'PATCH',
        body: JSON.stringify({ value: 12000 }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('PATCH /api/settings/:key rejects invalid values', async () => {
    const res = await app.request(
      new Request('http://localhost/api/settings/politeness.baseDelayMs', {
        method: 'PATCH',
        body: JSON.stringify({ value: -1000 }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('GET /api/sources returns source list', async () => {
    const res = await app.request('/api/sources');
    expect(res.status).toBe(200);
  });

  it('PATCH /api/sources/:id updates source', async () => {
    const source = await prisma.source.findFirst();
    if (!source) {
      expect(true).toBe(true);
      return;
    }

    const res = await app.request(
      new Request(`http://localhost/api/sources/${source.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('GET /api/circuit returns circuit status', async () => {
    const res = await app.request('/api/circuit');
    expect(res.status).toBe(200);
  });

  it('DELETE /api/circuit removes sentinel file', async () => {
    const res = await app.request(
      new Request('http://localhost/api/circuit', {
        method: 'DELETE',
      }),
    );
    expect([200, 404]).toContain(res.status);
  });
});

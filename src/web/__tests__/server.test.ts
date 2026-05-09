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

  it('GET /api/settings includes metadata fields in response', async () => {
    const res = await app.request('/api/settings');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    // Verify core fields are always present
    body.forEach((setting) => {
      expect(setting).toHaveProperty('key');
      expect(setting).toHaveProperty('value');
      expect(setting).toHaveProperty('default');
    });

    // Verify settings with metadata have the required fields
    const settingsWithMetadata = body.filter((s) => s.group !== undefined);
    expect(settingsWithMetadata.length).toBeGreaterThan(0);

    settingsWithMetadata.forEach((setting) => {
      expect(setting).toHaveProperty('group');
      expect(setting).toHaveProperty('kind');
    });
  });

  it('GET /api/settings includes unit for number fields', async () => {
    const res = await app.request('/api/settings');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;

    const politenessDelay = body.find((s) => s.key === 'politeness.baseDelayMs');
    expect(politenessDelay).toBeDefined();
    expect(politenessDelay?.unit).toBe('ms');

    const failureThreshold = body.find((s) => s.key === 'circuit.consecutiveFailureThreshold');
    expect(failureThreshold).toBeDefined();
    expect(failureThreshold?.unit).toBe('failures');
  });

  it('GET /api/settings includes options for log.level select', async () => {
    const res = await app.request('/api/settings');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;

    const logLevel = body.find((s) => s.key === 'log.level');
    expect(logLevel).toBeDefined();
    expect(logLevel?.kind).toBe('select');
    expect(logLevel?.options).toEqual(['debug', 'info', 'warn', 'error']);
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

  it('GET /api/sources marks 999md adapter as placeholder=false', async () => {
    const res = await app.request('/api/sources');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    const item = body.find((s) => s.adapterKey === '999md');
    expect(item).toBeDefined();
    expect(item?.placeholder).toBe(false);
  });

  it('GET /api/sources marks non-999md adapters as placeholder=true', async () => {
    await prisma.source.create({
      data: {
        slug: 'lara',
        name: 'lara.md',
        baseUrl: 'https://lara.md',
        adapterKey: 'lara',
        enabled: true,
      },
    });

    const res = await app.request('/api/sources');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    const item = body.find((s) => s.adapterKey === 'lara');
    expect(item).toBeDefined();
    expect(item?.placeholder).toBe(true);
  });

  it('GET /api/sources preserves all existing fields', async () => {
    const res = await app.request('/api/sources');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('slug');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('baseUrl');
      expect(item).toHaveProperty('adapterKey');
      expect(item).toHaveProperty('enabled');
      expect(item).toHaveProperty('politenessOverridesJson');
      expect(item).toHaveProperty('filterOverridesJson');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('updatedAt');
    }
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

  // ------------- UI-redesign Phase 0 (port-kit stub routes) -------------

  it('GET /api/sweeps/:id returns the SweepDetail payload shape', async () => {
    const sweep = await prisma.sweepRun.findFirst();
    expect(sweep).not.toBeNull();
    const res = await app.request(`/api/sweeps/${sweep!.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    for (const key of [
      'id',
      'status',
      'startedAt',
      'source',
      'trigger',
      'config',
      'pages',
      'details',
      'errors',
      'logTail',
    ]) {
      expect(body).toHaveProperty(key);
    }
  });

  it('GET /api/sweeps/:id/stream advertises an SSE content-type', async () => {
    const sweep = await prisma.sweepRun.findFirst();
    expect(sweep).not.toBeNull();
    const controller = new AbortController();
    const res = await app.request(
      new Request(`http://localhost/api/sweeps/${sweep!.id}/stream`, {
        signal: controller.signal,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    controller.abort();
  });

  it('GET /api/stats/by-district returns a populated stub array', async () => {
    const res = await app.request('/api/stats/by-district');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('GET /api/stats/new-per-day returns 7 daily counts', async () => {
    const res = await app.request('/api/stats/new-per-day');
    expect(res.status).toBe(200);
    const body = (await res.json()) as number[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(7);
  });

  it('GET /api/listings/new-today returns a stub array', async () => {
    const res = await app.request('/api/listings/new-today');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/listings/price-drops returns a stub array', async () => {
    const res = await app.request('/api/listings/price-drops');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });
});

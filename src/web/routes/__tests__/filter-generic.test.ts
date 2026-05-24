import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import { createApiApp } from '../../server.js';

let prisma: PrismaClient;
let app: Hono;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  prisma = new PrismaClient({ datasources: { db: { url } } });
  app = createApiApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.setting.deleteMany();
});

describe('GET /api/filter — new generic shape', () => {
  it('returns category and filters[] in generic', async () => {
    const res = await app.request('/api/filter');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generic: { category: string; filters: unknown[] };
    };
    expect(body.generic.category).toBe('house');
    expect(Array.isArray(body.generic.filters)).toBe(true);
    expect(body.generic.filters.length).toBeGreaterThan(0);
  });

  it('resolved.postFilter has minPriceEur and maxPriceEur (no maxAreaSqm)', async () => {
    const res = await app.request('/api/filter');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resolved: { postFilter: Record<string, unknown> };
    };
    expect(body.resolved.postFilter).toHaveProperty('minPriceEur');
    expect(body.resolved.postFilter).toHaveProperty('maxPriceEur');
    expect(body.resolved.postFilter).not.toHaveProperty('maxAreaSqm');
  });
});

describe('PUT /api/filter — new generic shape', () => {
  it('persists new-shape filter and round-trips correctly', async () => {
    const newFilter = {
      category: 'apartment',
      filters: [
        { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
        { kind: 'options', filterId: 32, featureId: 7, optionIds: [12900] },
        { kind: 'range', filterId: 9441, featureId: 2, unit: 'UNIT_EUR', max: '180000' },
      ],
    };
    const res = await app.request('/api/filter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generic: newFilter }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resolved: { postFilter: { maxPriceEur: number } };
      generic: { category: string };
    };
    expect(body.resolved.postFilter.maxPriceEur).toBe(180_000);
    expect(body.generic.category).toBe('apartment');

    const re = await app.request('/api/filter');
    const reBody = (await re.json()) as { generic: { category: string } };
    expect(reBody.generic.category).toBe('apartment');
  });

  it('rejects range with min > max with 400', async () => {
    const res = await app.request('/api/filter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generic: {
          category: 'house',
          filters: [
            { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
            { kind: 'range', filterId: 1201, featureId: 588, min: '10', max: '2' },
          ],
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects empty optionIds with 400', async () => {
    const res = await app.request('/api/filter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generic: {
          category: 'house',
          filters: [{ kind: 'options', filterId: 16, featureId: 1, optionIds: [] }],
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 with UnknownGenericFilterValueError details on unknown filterId', async () => {
    const res = await app.request('/api/filter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generic: {
          category: 'house',
          filters: [{ kind: 'options', filterId: 99999, featureId: 1, optionIds: [776] }],
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: Array<{ path: string }> };
    expect(body.details.some((d) => d.path === 'filterId')).toBe(true);
  });
});

describe('GET /api/filter/taxonomy', () => {
  it('returns an array of filter descriptors', async () => {
    const res = await app.request('/api/filter/taxonomy');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('each entry has filterId, label, kind, and features', async () => {
    const res = await app.request('/api/filter/taxonomy');
    const body = (await res.json()) as Array<{
      filterId: number;
      label: string;
      kind: string;
      features: Array<{ featureId: number; label: string }>;
    }>;
    for (const entry of body.slice(0, 5)) {
      expect(typeof entry.filterId).toBe('number');
      expect(typeof entry.label).toBe('string');
      expect(['options', 'range', 'boolean']).toContain(entry.kind);
      expect(Array.isArray(entry.features)).toBe(true);
      expect(entry.features.length).toBeGreaterThan(0);
      expect(typeof entry.features[0]?.featureId).toBe('number');
      expect(typeof entry.features[0]?.label).toBe('string');
    }
  });

  it('offer-type filter (16) has kind=options with option labels', async () => {
    const res = await app.request('/api/filter/taxonomy');
    const body = (await res.json()) as Array<{
      filterId: number;
      kind: string;
      features: Array<{
        featureId: number;
        options?: Array<{ id: number; label: string }>;
      }>;
    }>;
    const offerType = body.find((e) => e.filterId === 16);
    expect(offerType).toBeDefined();
    expect(offerType?.kind).toBe('options');
    expect(offerType?.features[0]?.options).toBeDefined();
    expect(offerType?.features[0]?.options?.some((o) => o.id === 776)).toBe(true);
  });

  it('amenities filter (4132) has kind=boolean with multiple features', async () => {
    const res = await app.request('/api/filter/taxonomy');
    const body = (await res.json()) as Array<{
      filterId: number;
      kind: string;
      features: Array<{ featureId: number }>;
    }>;
    const amenities = body.find((e) => e.filterId === 4132);
    expect(amenities).toBeDefined();
    expect(amenities?.kind).toBe('boolean');
    expect(amenities?.features.length ?? 0).toBeGreaterThan(1);
  });

  it('total area filter (1073) has kind=range and carries unit in feature', async () => {
    const res = await app.request('/api/filter/taxonomy');
    const body = (await res.json()) as Array<{
      filterId: number;
      kind: string;
      features: Array<{ featureId: number; unit?: string }>;
    }>;
    const area = body.find((e) => e.filterId === 1073);
    expect(area).toBeDefined();
    expect(area?.kind).toBe('range');
    expect(area?.features[0]?.unit).toBe('UNIT_METER_SQUARE');
  });

  it('region filter (32) includes all features (raion, localitate, sector)', async () => {
    const res = await app.request('/api/filter/taxonomy');
    const body = (await res.json()) as Array<{
      filterId: number;
      features: Array<{ featureId: number }>;
    }>;
    const region = body.find((e) => e.filterId === 32);
    expect(region?.features.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('price filter (9441) has kind=range', async () => {
    const res = await app.request('/api/filter/taxonomy');
    const body = (await res.json()) as Array<{
      filterId: number;
      kind: string;
    }>;
    const price = body.find((e) => e.filterId === 9441);
    expect(price).toBeDefined();
    expect(price?.kind).toBe('range');
  });

  it('?category=house returns house-specific filter 1207 (Stare casă) and not apartment-specific 1191 (Etaj)', async () => {
    const res = await app.request('/api/filter/taxonomy?category=house');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ filterId: number }>;
    expect(body.map((e) => e.filterId)).toContain(1207);
    expect(body.map((e) => e.filterId)).not.toContain(1191);
  });

  it('?category=apartment returns apartment-specific filter 1191 (Etaj) and not house-specific 1207 (Stare casă)', async () => {
    const res = await app.request('/api/filter/taxonomy?category=apartment');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ filterId: number }>;
    expect(body.map((e) => e.filterId)).toContain(1191);
    expect(body.map((e) => e.filterId)).not.toContain(1207);
  });

  it('unknown ?category returns 400', async () => {
    const res = await app.request('/api/filter/taxonomy?category=cottage');
    expect(res.status).toBe(400);
  });

  it('no ?category param defaults to house taxonomy (active filter default)', async () => {
    const res = await app.request('/api/filter/taxonomy');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ filterId: number }>;
    expect(body.map((e) => e.filterId)).toContain(1207);
  });
});

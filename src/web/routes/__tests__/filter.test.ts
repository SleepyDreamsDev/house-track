import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import { createApiApp } from '../../server.js';
import { defaultGenericFilter } from '../../../types/filter.js';

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

describe('GET /api/filter', () => {
  it('returns the active generic filter, sources list, and resolved input', async () => {
    const res = await app.request('/api/filter');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generic: unknown;
      sources: Array<{ slug: string; name: string; active: boolean }>;
      resolved: { searchInput: { subCategoryId: number }; postFilter: Record<string, number> };
    };
    expect(body.generic).toBeDefined();
    expect(body.sources).toEqual([{ slug: '999md', name: '999.md', active: true }]);
    expect(body.resolved.searchInput.subCategoryId).toBe(1406);
    expect(body.resolved.postFilter.maxPriceEur).toBe(250_000);
  });
});

describe('PUT /api/filter', () => {
  it('persists a valid generic filter and returns the resolved view', async () => {
    const res = await app.request('/api/filter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generic: { ...defaultGenericFilter, priceMax: 180_000 } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resolved: { postFilter: Record<string, number> };
    };
    expect(body.resolved.postFilter.maxPriceEur).toBe(180_000);

    const re = await app.request('/api/filter');
    const reBody = (await re.json()) as { generic: { priceMax: number } };
    expect(reBody.generic.priceMax).toBe(180_000);
  });

  it('accepts a top-level body shape (not wrapped in {generic})', async () => {
    const res = await app.request('/api/filter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...defaultGenericFilter, priceMax: 200_000 }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects priceMin > priceMax with a 400 carrying field path', async () => {
    const res = await app.request('/api/filter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generic: { ...defaultGenericFilter, priceMin: 300_000, priceMax: 100_000 },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: Array<{ path: string }> };
    expect(body.details.some((d) => d.path === 'priceMin')).toBe(true);
  });

  it('rejects an unmapped locality with a 400', async () => {
    const res = await app.request('/api/filter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generic: { ...defaultGenericFilter, locality: ['atlantis'] } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details?: Array<{ path: string }>; error: string };
    expect(typeof body.error).toBe('string');
  });

  it('rejects malformed JSON with a 400', async () => {
    const res = await app.request('/api/filter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });
});

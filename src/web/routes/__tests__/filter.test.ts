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
    const newFilter = {
      category: 'house',
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
      resolved: { postFilter: Record<string, number> };
    };
    expect(body.resolved.postFilter.maxPriceEur).toBe(180_000);

    const re = await app.request('/api/filter');
    const reBody = (await re.json()) as { generic: { category: string } };
    expect(reBody.generic.category).toBe('house');
  });

  it('accepts a top-level body shape (not wrapped in {generic})', async () => {
    const res = await app.request('/api/filter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...defaultGenericFilter }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects range with min > max with 400 carrying a validation error', async () => {
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

  it('rejects an unknown filterId with a 400', async () => {
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
    const body = (await res.json()) as { error: string };
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

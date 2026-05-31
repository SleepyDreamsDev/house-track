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
  await prisma.source.deleteMany();
});

async function seedSource(): Promise<number> {
  const s = await prisma.source.create({
    data: { slug: '999md', name: '999.md', baseUrl: 'https://999.md', adapterKey: '999md' },
  });
  return s.id;
}

async function patch(id: string | number, body: unknown): Promise<Response> {
  return app.request(`/api/sources/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/sources/:id input validation', () => {
  it('rejects a non-numeric id with 400', async () => {
    const res = await patch('abc', { enabled: false });
    expect(res.status).toBe(400);
  });

  it('rejects a non-boolean enabled with 400', async () => {
    const id = await seedSource();
    const res = await patch(id, { enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('rejects politenessOverridesJson with unknown keys (strict)', async () => {
    const id = await seedSource();
    const res = await patch(id, { politenessOverridesJson: { baseDelayMs: 5000, evil: 1 } });
    expect(res.status).toBe(400);
  });

  it('rejects politenessOverridesJson with a wrong-typed field', async () => {
    const id = await seedSource();
    const res = await patch(id, { politenessOverridesJson: { baseDelayMs: 'fast' } });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed filterOverridesJson', async () => {
    const id = await seedSource();
    const res = await patch(id, { filterOverridesJson: { not: 'a filter' } });
    expect(res.status).toBe(400);
  });

  it('accepts a valid politeness override and persists it', async () => {
    const id = await seedSource();
    const res = await patch(id, { politenessOverridesJson: { baseDelayMs: 9000 } });
    expect(res.status).toBe(200);
    const row = await prisma.source.findUnique({ where: { id } });
    expect(row?.politenessOverridesJson).toEqual({ baseDelayMs: 9000 });
  });

  it('accepts null to clear an override', async () => {
    const id = await seedSource();
    const res = await patch(id, { filterOverridesJson: null });
    expect(res.status).toBe(200);
  });
});

describe('numeric query/param guards', () => {
  it('GET /api/sweeps/:id/errors with a non-numeric id returns 400, not 500', async () => {
    const res = await app.request('/api/sweeps/abc/errors');
    expect(res.status).toBe(400);
  });

  it('GET /api/listings with a NaN limit falls back instead of erroring', async () => {
    const res = await app.request('/api/listings?limit=abc&minPrice=xyz');
    expect(res.status).toBe(200);
  });
});

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Hono } from 'hono';

import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

describe('Single-active-sweep invariant', () => {
  let prisma: PrismaClient;
  let app: Hono;

  beforeAll(async () => {
    prisma = getPrisma();
    app = createApiApp();
  });

  beforeEach(async () => {
    await prisma.sweepRun.deleteMany();
  });

  async function seedInProgress(): Promise<{ id: number }> {
    const row = await prisma.sweepRun.create({
      data: {
        startedAt: new Date(),
        status: 'in_progress',
        source: '999.md',
        trigger: 'manual',
      },
      select: { id: true },
    });
    return row;
  }

  it('Manual sweep is rejected when another sweep is in_progress', async () => {
    const seeded = await seedInProgress();
    const before = await prisma.sweepRun.count();

    const res = await app.request('/api/sweeps', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['error']).toBe('sweep_in_progress');
    expect(body['activeSweepId']).toBe(seeded.id);

    const after = await prisma.sweepRun.count();
    expect(after).toBe(before);
  });

  it('Manual smoke is rejected when another sweep is in_progress', async () => {
    await seedInProgress();
    const before = await prisma.sweepRun.count();

    const res = await app.request('/api/sweeps/smoke', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['error']).toBe('sweep_in_progress');

    const after = await prisma.sweepRun.count();
    expect(after).toBe(before);
  });

  it('Manual sweep is allowed after the in_progress sweep is cancelled', async () => {
    const seeded = await seedInProgress();

    const cancelRes = await app.request(`/api/sweeps/${seeded.id}/cancel`, { method: 'POST' });
    expect(cancelRes.status).toBe(200);

    const startRes = await app.request('/api/sweeps', { method: 'POST' });
    expect(startRes.status).toBe(201);

    const body = (await startRes.json()) as Record<string, unknown>;
    expect(typeof body['id']).toBe('number');
    expect(body['id']).not.toBe(seeded.id);
  });
});

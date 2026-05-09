import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Hono } from 'hono';

import { getPrisma } from '../../../db.js';
import { useTempCircuitSentinel } from '../../../__tests__/helpers/circuit-sentinel.js';
import { createApiApp } from '../../server.js';

describe('Smoke route + trigger surfacing', () => {
  let prisma: PrismaClient;
  let app: Hono;
  const sentinel = useTempCircuitSentinel();

  beforeAll(() => {
    prisma = getPrisma();
    app = createApiApp();
  });

  beforeEach(async () => {
    await prisma.sweepRun.deleteMany();
  });

  it('Scenario: refuses with 409 when circuit breaker is open', async () => {
    sentinel.tripBreaker();

    const before = await prisma.sweepRun.count();
    const res = await app.request('/api/sweeps/smoke', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('circuit_open');

    const after = await prisma.sweepRun.count();
    expect(after).toBe(before);
  });

  it('Scenario: GET /api/sweeps surfaces the trigger field', async () => {
    await prisma.sweepRun.create({
      data: { status: 'ok', source: '999.md', trigger: 'smoke', finishedAt: new Date() },
    });

    const res = await app.request('/api/sweeps?limit=10');
    const body = (await res.json()) as {
      sweeps: Array<Record<string, unknown>>;
      total: number;
    };

    expect(body.sweeps).toHaveLength(1);
    expect(body.sweeps[0]?.trigger).toBe('smoke');
  });

  it('Scenario: GET /api/sweeps/:id/smoke-assertions returns assertions for a finished smoke sweep', async () => {
    const sweep = await prisma.sweepRun.create({
      data: {
        status: 'ok',
        source: '999.md',
        trigger: 'smoke',
        startedAt: new Date(Date.now() - 30_000),
        finishedAt: new Date(),
      },
    });

    const res = await app.request(`/api/sweeps/${sweep.id}/smoke-assertions`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.sweepId).toBe(sweep.id);
    expect(body.durationMs).toEqual(expect.any(Number));
    expect(typeof body.passed).toBe('boolean');
    expect(Array.isArray(body.assertions)).toBe(true);
  });

  it('Scenario: GET /api/sweeps/:id/smoke-assertions returns pending while sweep still running', async () => {
    const sweep = await prisma.sweepRun.create({
      data: { status: 'running', source: '999.md', trigger: 'smoke' },
    });

    const res = await app.request(`/api/sweeps/${sweep.id}/smoke-assertions`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.pending).toBe(true);
    expect(body.sweepId).toBe(sweep.id);
  });

  it('Scenario: GET /api/sweeps/:id/smoke-assertions refuses non-smoke sweeps', async () => {
    const sweep = await prisma.sweepRun.create({
      data: {
        status: 'ok',
        source: '999.md',
        trigger: 'manual',
        finishedAt: new Date(),
      },
    });

    const res = await app.request(`/api/sweeps/${sweep.id}/smoke-assertions`);

    expect(res.status).toBe(409);
  });
});

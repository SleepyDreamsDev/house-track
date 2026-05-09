import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Hono } from 'hono';

import { CIRCUIT } from '../../../config.js';
import { getPrisma } from '../../../db.js';
import { createApiApp } from '../../server.js';

describe('Smoke route + trigger surfacing', () => {
  let prisma: PrismaClient;
  let app: Hono;
  let dir: string;
  let originalSentinel: string;

  beforeAll(() => {
    prisma = getPrisma();
    app = createApiApp();
    originalSentinel = CIRCUIT.sentinelPath;
  });

  afterAll(() => {
    (CIRCUIT as { sentinelPath: string }).sentinelPath = originalSentinel;
  });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'smoke-'));
    (CIRCUIT as { sentinelPath: string }).sentinelPath = join(dir, '.circuit_open');
    await prisma.sweepRun.deleteMany();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Scenario: refuses with 409 when circuit breaker is open', async () => {
    writeFileSync(CIRCUIT.sentinelPath, '');

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
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(body).toHaveLength(1);
    expect(body[0]?.trigger).toBe('smoke');
  });
});

import { promises as fs } from 'node:fs';
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Circuit } from '../circuit.js';

const HOUR = 60 * 60 * 1000;

describe('Circuit', () => {
  let dir: string;
  let sentinelPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'circuit-'));
    sentinelPath = join(dir, '.circuit_open');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const make = (overrides: Partial<ConstructorParameters<typeof Circuit>[0]> = {}) =>
    new Circuit({
      sentinelPath,
      threshold: 3,
      pauseDurationMs: 24 * HOUR,
      ...overrides,
    });

  it('A fresh circuit is closed', async () => {
    const circuit = make();
    expect(await circuit.isOpen()).toBe(false);
  });

  it('Hitting the threshold trips the circuit', async () => {
    const circuit = make();
    await circuit.recordFailure();
    await circuit.recordFailure();
    await circuit.recordFailure();
    await expect(stat(sentinelPath)).resolves.toBeDefined();
    expect(await circuit.isOpen()).toBe(true);
  });

  it('A success between failures resets the counter', async () => {
    const circuit = make();
    await circuit.recordFailure();
    await circuit.recordFailure();
    circuit.recordSuccess();
    await circuit.recordFailure();
    await circuit.recordFailure();
    await expect(stat(sentinelPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await circuit.isOpen()).toBe(false);
  });

  it('A sentinel within the cooldown window keeps the circuit open', async () => {
    await writeFile(sentinelPath, '');
    const oneHourAgo = (Date.now() - HOUR) / 1000;
    await utimes(sentinelPath, oneHourAgo, oneHourAgo);

    const circuit = make();
    expect(await circuit.isOpen()).toBe(true);
  });

  it('A sentinel older than the cooldown closes the circuit', async () => {
    await writeFile(sentinelPath, '');
    const ancient = (Date.now() - 25 * HOUR) / 1000;
    await utimes(sentinelPath, ancient, ancient);

    const circuit = make();
    expect(await circuit.isOpen()).toBe(false);
  });

  it('Deleting the sentinel manually closes the circuit', async () => {
    const circuit = make();
    await circuit.recordFailure();
    await circuit.recordFailure();
    await circuit.recordFailure();
    expect(await circuit.isOpen()).toBe(true);

    await fs.unlink(sentinelPath);
    expect(await circuit.isOpen()).toBe(false);
  });

  it('tripImmediately opens the breaker on the first call (for 403/429)', async () => {
    const circuit = make();
    await circuit.tripImmediately();
    await expect(stat(sentinelPath)).resolves.toBeDefined();
    expect(await circuit.isOpen()).toBe(true);
  });

  it('recordFailure does not throw if the sentinel directory is missing', async () => {
    const nestedPath = join(dir, 'nested', 'deeper', '.circuit_open');
    const circuit = make({ sentinelPath: nestedPath });

    await circuit.recordFailure();
    await circuit.recordFailure();
    await circuit.recordFailure();

    await expect(stat(nestedPath)).resolves.toBeDefined();
  });
});

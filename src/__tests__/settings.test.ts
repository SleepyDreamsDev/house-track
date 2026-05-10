import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getSetting, setSetting, listSettings } from '../settings.js';

let prisma: PrismaClient;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — vitest setup must run first');
  // Use the DATABASE_URL environment variable set by vitest.setup.ts
  prisma = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.setting.deleteMany();
});

describe('Settings', () => {
  it('returns a setting from the database', async () => {
    // Arrange: seed the database with a setting
    await prisma.setting.create({
      data: { key: 'politeness.baseDelayMs', valueJson: 12000 },
    });

    // Act
    const result = await getSetting('politeness.baseDelayMs');

    // Assert
    expect(result).toBe(12000);
  });

  it('falls back to defaults when setting is not in database', async () => {
    // Act
    const result = await getSetting('politeness.jitterMs');

    // Assert
    expect(result).toBe(2000); // default from config
  });

  it('stores a new setting via setSetting', async () => {
    // Act
    await setSetting('sweep.maxPagesPerSweep', 75);
    const result = await getSetting('sweep.maxPagesPerSweep');

    // Assert
    expect(result).toBe(75);

    const row = await prisma.setting.findUnique({
      where: { key: 'sweep.maxPagesPerSweep' },
    });
    expect(row?.valueJson).toBe(75);
  });

  it('updates an existing setting via setSetting', async () => {
    // Arrange
    await prisma.setting.create({
      data: { key: 'politeness.baseDelayMs', valueJson: 9000 },
    });

    // Act
    await setSetting('politeness.baseDelayMs', 12000);
    const result = await getSetting('politeness.baseDelayMs');

    // Assert
    expect(result).toBe(12000);
  });

  it('validates setting writes against zod schemas', async () => {
    // Act & Assert
    await expect(setSetting('politeness.baseDelayMs', -1000)).rejects.toThrow();
  });

  it('lists all settings with their current and default values', async () => {
    // Arrange
    await prisma.setting.create({
      data: { key: 'politeness.baseDelayMs', valueJson: 10000 },
    });

    // Act
    const results = await listSettings();

    // Assert
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const baseDelay = results.find((s) => s.key === 'politeness.baseDelayMs');
    expect(baseDelay).toBeDefined();
    expect(baseDelay?.value).toBe(10000);
    expect(baseDelay?.default).toBe(8000); // config default
    expect(baseDelay?.schema).toBeDefined();
  });

  it('includes metadata fields in listSettings() response', async () => {
    // Act
    const results = await listSettings();

    // Assert
    expect(results.length).toBeGreaterThan(0);

    // Verify each setting that has metadata has the required fields
    const settingsWithMetadata = results.filter(
      (s): s is (typeof results)[0] & { group: string; kind: 'number' | 'text' | 'select' } =>
        s.group !== undefined,
    );
    expect(settingsWithMetadata.length).toBeGreaterThan(0);

    settingsWithMetadata.forEach((setting) => {
      expect(setting).toHaveProperty('group');
      expect(setting).toHaveProperty('kind');
      expect(['number', 'text', 'select']).toContain(setting.kind);
      expect(typeof setting.group).toBe('string');
      expect(setting.group.length).toBeGreaterThan(0);
    });
  });

  it('assigns correct group to politeness settings', async () => {
    // Act
    const results = await listSettings();

    // Assert
    const politenessSettings = results.filter((s) => s.key.startsWith('politeness.'));
    politenessSettings.forEach((setting) => {
      expect(setting.group).toBe('Politeness');
      expect(setting.kind).toBe('number');
      // The base/jitter/detail delays are milliseconds; the soft-throttle keys
      // are a multiplier (×) and a duration (min). All are numeric tunables.
      expect(['ms', '×', 'min']).toContain(setting.unit);
    });
  });

  it('assigns correct group to sweep settings', async () => {
    // Act
    const results = await listSettings();

    // Assert
    const sweepSettings = results.filter((s) => s.key.startsWith('sweep.'));
    sweepSettings.forEach((setting) => {
      expect(setting.group).toBe('Sweep');
      // 'select' covers sweep.mode (legacy/two_tier), the others are
      // numbers/text. Keep this list narrow — a stray 'tags' or other novel
      // kind should still fail the assertion.
      expect(['number', 'text', 'select']).toContain(setting.kind);
    });
  });

  it('assigns correct group to circuit breaker settings', async () => {
    // Act
    const results = await listSettings();

    // Assert
    const circuitSettings = results.filter((s) => s.key.startsWith('circuit.'));
    circuitSettings.forEach((setting) => {
      expect(setting.group).toBe('Circuit breaker');
      expect(setting.kind).toBe('number');
      expect(['ms', 'failures']).toContain(setting.unit);
    });
  });

  it('hides filter.* keys from listSettings (edited via dedicated /filter page)', async () => {
    // Act
    const results = await listSettings();

    // Assert: no filter.* row leaks into the generic Settings list — the
    // dedicated /filter page owns these now.
    const filterSettings = results.filter((s) => s.key.startsWith('filter.'));
    expect(filterSettings).toEqual([]);
  });

  it('assigns correct metadata to log.level (select with options)', async () => {
    // Act
    const results = await listSettings();

    // Assert
    const logLevel = results.find((s) => s.key === 'log.level');
    expect(logLevel).toBeDefined();
    expect(logLevel?.group).toBe('Logging');
    expect(logLevel?.kind).toBe('select');
    expect(logLevel?.options).toEqual(['debug', 'info', 'warn', 'error']);
  });
});

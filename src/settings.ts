import { z } from 'zod';

import { CIRCUIT, FILTER, POLITENESS, SWEEP } from './config.js';
import { getPrisma } from './db.js';

// Define schemas for each setting
const settingSchemas = {
  'politeness.baseDelayMs': z.number().int().positive(),
  'politeness.jitterMs': z.number().int().nonnegative(),
  'politeness.detailDelayMs': z.number().int().positive(),
  'sweep.maxPagesPerSweep': z.number().int().positive(),
  'sweep.backfillPerSweep': z.number().int().nonnegative(),
  'sweep.cronSchedule': z.string().min(1),
  'circuit.consecutiveFailureThreshold': z.number().int().positive(),
  'circuit.pauseDurationMs': z.number().int().positive(),
  'filter.maxPriceEur': z.number().int().positive(),
  'filter.maxAreaSqm': z.number().positive(),
  'filter.searchInputJson': z.any(),
  'log.level': z.union([
    z.literal('debug'),
    z.literal('info'),
    z.literal('warn'),
    z.literal('error'),
  ]),
} as const;

// Map of setting keys to their default values from config.ts
const defaultValues: Record<string, unknown> = {
  'politeness.baseDelayMs': POLITENESS.baseDelayMs,
  'politeness.jitterMs': POLITENESS.jitterMs,
  'politeness.detailDelayMs': POLITENESS.detailDelayMs,
  'sweep.maxPagesPerSweep': FILTER.maxPagesPerSweep,
  'sweep.backfillPerSweep': SWEEP.backfillPerSweep,
  'sweep.cronSchedule': '0 * * * *', // default hourly
  'circuit.consecutiveFailureThreshold': CIRCUIT.consecutiveFailureThreshold,
  'circuit.pauseDurationMs': CIRCUIT.pauseDurationMs,
  'filter.maxPriceEur': FILTER.postFilter.maxPriceEur,
  'filter.maxAreaSqm': FILTER.postFilter.maxAreaSqm,
  'filter.searchInputJson': FILTER.searchInput,
  'log.level': 'info',
};

export async function getSetting<T = unknown>(key: string, fallback?: T): Promise<T> {
  const prisma = getPrisma();

  const setting = await prisma.setting.findUnique({
    where: { key },
  });

  if (setting !== null && setting !== undefined) {
    return setting.valueJson as T;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  const defaultVal = defaultValues[key];
  if (defaultVal !== undefined) {
    return defaultVal as T;
  }

  throw new Error(`Setting key "${key}" not found and no default provided`);
}

export async function setSetting<T = unknown>(key: string, value: T): Promise<void> {
  // Validate against the schema
  const schema = settingSchemas[key as keyof typeof settingSchemas];
  if (!schema) {
    throw new Error(`Unknown setting key: ${key}`);
  }

  const parsed = schema.parse(value);
  const prisma = getPrisma();

  // Prisma's JSON type requires explicit any cast for validated zod objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonValue = parsed as any;

  await prisma.setting.upsert({
    where: { key },
    update: { valueJson: jsonValue },
    create: { key, valueJson: jsonValue },
  });
}

export async function listSettings(): Promise<
  Array<{
    key: string;
    value: unknown;
    default: unknown;
    schema: z.ZodSchema;
  }>
> {
  const prisma = getPrisma();
  const allSettings = await prisma.setting.findMany();

  const settingMap = new Map(allSettings.map((s) => [s.key, s.valueJson]));

  return Object.entries(settingSchemas).map(([key, schema]) => ({
    key,
    value: settingMap.get(key) ?? defaultValues[key],
    default: defaultValues[key],
    schema,
  }));
}

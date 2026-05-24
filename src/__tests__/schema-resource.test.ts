import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  SCHEMA_RESOURCE_URI,
  loadSchemaText,
  resetSchemaCache,
  schemaReadCount,
} from '../mcp/schema-resource.js';

const SCHEMA_PATH = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));

function modelNames(): string[] {
  const src = readFileSync(SCHEMA_PATH, 'utf8');
  return [...src.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1] as string);
}

describe('schema resource', () => {
  beforeEach(() => resetSchemaCache());

  it('Has a stable resource URI', () => {
    expect(SCHEMA_RESOURCE_URI).toBe('schema://house-track');
  });

  it('Includes every model declared in prisma/schema.prisma', () => {
    const text = loadSchemaText();
    const models = modelNames();
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) expect(text).toContain(`model ${m}`);
  });

  it('Includes the timezone preamble', () => {
    expect(loadSchemaText()).toMatch(/Europe\/Chisinau/);
  });

  it('Reads the schema file from disk only once (memoized)', () => {
    loadSchemaText();
    loadSchemaText();
    loadSchemaText();
    expect(schemaReadCount()).toBe(1);
  });
});

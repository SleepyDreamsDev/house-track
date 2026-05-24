// The `schema://house-track` MCP resource.
//
// Serves prisma/schema.prisma verbatim (it already carries the semantic
// comments Claude needs) plus a short preamble. Reading the file means zero
// drift — there is no hand-maintained data dictionary to rot. Memoized: the
// file is read once per process.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCHEMA_RESOURCE_URI = 'schema://house-track';

// Resolved relative to this module so it works both under tsx (src/mcp/) and
// the compiled build (dist/mcp/) — `../../` lands on the repo root either way.
const SCHEMA_PATH = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));

const SCHEMA_PREAMBLE = `-- house-track database (PostgreSQL, READ ONLY via the run_sql tool).
-- Timezone: Europe/Chisinau — naive timestamps are local Chișinău time.
-- Prices: priceEur is EUR-normalized (nullable; ~90% of rows). priceRaw keeps
--   the original source string for audit.
-- filterId = 0 means the 999.md taxonomy group is not yet captured; match on
--   (featureId, optionId) instead.
-- Table and column names are case-sensitive — quote them in SQL, e.g.
--   SELECT "priceEur" FROM "Listing".
-- The Prisma schema below is the source of truth for tables, columns, and indexes.
`;

let cached: string | undefined;
let readCount = 0;

/** Full resource text: preamble + the raw Prisma schema. Read from disk once. */
export function loadSchemaText(): string {
  if (cached === undefined) {
    cached = `${SCHEMA_PREAMBLE}\n${readFileSync(SCHEMA_PATH, 'utf8')}`;
    readCount += 1;
  }
  return cached;
}

// ── test seams ──
export function resetSchemaCache(): void {
  cached = undefined;
  readCount = 0;
}

export function schemaReadCount(): number {
  return readCount;
}

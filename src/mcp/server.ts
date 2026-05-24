// Local stdio MCP server. Spawned by Claude Desktop on demand; reads the
// PostgreSQL database the crawler writes to. Read-only — no mutations exposed.
//
// Curated tools (Prisma-backed, see queries.ts):
//   list_filters()  — observed (filterId, featureId) → optionIds universe
//   search_listings — multi-criteria query returning clickable 999.md URLs
//   get_listing(id) — full record + filter triples for one listing
//
// Open-ended "ask the data" (pg-backed, see sql-runner.ts):
//   run_sql(sql)    — single guarded read-only SELECT, capped + cached
//   schema://house-track resource — the Prisma schema, so Claude can compose SQL

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { getListing, listFilters, searchListings } from './queries.js';
import { SCHEMA_RESOURCE_URI, loadSchemaText } from './schema-resource.js';
import { SqlRunner } from './sql-runner.js';

const prisma = new PrismaClient();
const sqlRunner = new SqlRunner(); // reads DATABASE_URL_RO from env (lazy pool)

const server = new McpServer(
  { name: 'house-track', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {} } },
);

server.registerTool(
  'list_filters',
  {
    description:
      'Aggregate the observed filter universe across the local DB. Returns groups of (filterId, featureId, optionIds[], sampleListingIds[], listingCount). Use sample ids with get_listing to discover human-readable labels.',
    inputSchema: {},
  },
  async () => {
    const groups = await listFilters(prisma);
    return { content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }] };
  },
);

server.registerTool(
  'search_listings',
  {
    description:
      'Search Chișinău houses for sale in the local DB. Range filters (minPrice/maxPrice/minRooms/maxRooms/minAreaSqm/maxAreaSqm), `district`, and `sector` are AND-ed. Use `sector` for a Chișinău sub-area (e.g. "Buiucani", "Centru", "Botanica", "Telecentru") — that\'s where those names live; `district` is the broader region (e.g. "Chișinău", "Ialoveni"). Both accept a single value or a comma-separated list. The `filters` array AND-s across (featureId, optionIds) groups and OR-s within each group\'s optionIds. Returns clickable https://999.md/ro/<id> URLs.',
    inputSchema: {
      minPrice: z.number().optional(),
      maxPrice: z.number().optional(),
      minRooms: z.number().int().optional(),
      maxRooms: z.number().int().optional(),
      minAreaSqm: z.number().optional(),
      maxAreaSqm: z.number().optional(),
      district: z.string().optional(),
      sector: z.string().optional(),
      filters: z
        .array(
          z.object({
            filterId: z.number().int().optional(),
            featureId: z.number().int(),
            optionIds: z.array(z.number().int()),
          }),
        )
        .optional(),
      sort: z.enum(['priceAsc', 'priceDesc', 'pricePerSqmAsc', 'newest']).optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
  },
  async (input) => {
    const rows = await searchListings(prisma, input);
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  },
);

server.registerTool(
  'get_listing',
  {
    description:
      'Return the full record for a single listing including all filter-value triples. Useful for reading labels/translated values for the option ids returned by list_filters.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const listing = await getListing(prisma, id);
    if (!listing) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Listing not found: ${id}` }],
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(listing, null, 2) }] };
  },
);

server.registerResource(
  'schema',
  SCHEMA_RESOURCE_URI,
  {
    title: 'house-track database schema',
    description:
      'PostgreSQL/Prisma schema (tables, columns, indexes, semantics). Read this before composing a run_sql query.',
    mimeType: 'text/plain',
  },
  (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/plain', text: loadSchemaText() }],
  }),
);

server.registerTool(
  'run_sql',
  {
    description:
      'Run ONE read-only SQL query (SELECT, or WITH … SELECT) against the house-track Postgres DB; returns rows as JSON. Read the schema://house-track resource first for tables/columns. Prefer aggregates (count/avg/GROUP BY) over dumping rows — results are capped at 500 rows / ~100 KB and the envelope reports `truncated`. Writes, multiple statements, and non-SELECT are rejected. Identifiers are case-sensitive — quote them, e.g. SELECT "priceEur" FROM "Listing".',
    inputSchema: { sql: z.string() },
  },
  async ({ sql }) => {
    try {
      const result = await sqlRunner.run(sql);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: scrubError(err) }] };
    }
  },
);

// Surface a readable message without leaking any connection-string credentials.
// Greedy `[^\s]*@` scrubs through the LAST `@` in the credential run, so an
// unencoded `@` inside the password can't leak its tail.
function scrubError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/(postgres(?:ql)?:\/\/)[^\s]*@/gi, '$1***@');
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main().catch((err) => {
  // stdout is reserved for JSON-RPC; route errors to stderr so Claude Desktop's
  // log shows them without corrupting the protocol stream.
  process.stderr.write(`mcp server fatal: ${String(err)}\n`);
  process.exit(1);
});

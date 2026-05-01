// Local stdio MCP server. Spawned by Claude Desktop on demand; reads the same
// SQLite file the crawler writes to. Read-only — no mutations exposed.
//
// Three tools:
//   list_filters()  — observed (filterId, featureId) → optionIds universe
//   search_listings — multi-criteria query returning clickable 999.md URLs
//   get_listing(id) — full record + filter triples for one listing

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { getListing, listFilters, searchListings } from './queries.js';

const prisma = new PrismaClient();

const server = new McpServer(
  { name: 'house-track', version: '0.1.0' },
  { capabilities: { tools: {} } },
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
      "Search Chișinău houses for sale in the local DB. Range filters (minPrice/maxPrice/minRooms/maxRooms/minAreaSqm/maxAreaSqm) and `district` are AND-ed. The `filters` array AND-s across (featureId, optionIds) groups and OR-s within each group's optionIds. Returns clickable https://999.md/ro/<id> URLs.",
    inputSchema: {
      minPrice: z.number().optional(),
      maxPrice: z.number().optional(),
      minRooms: z.number().int().optional(),
      maxRooms: z.number().int().optional(),
      minAreaSqm: z.number().optional(),
      maxAreaSqm: z.number().optional(),
      district: z.string().optional(),
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

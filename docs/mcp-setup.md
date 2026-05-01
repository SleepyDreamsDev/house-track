# Wiring `house-track` into Claude Desktop

The `house-track-mcp` server is a local stdio Model Context Protocol process
that Claude Desktop spawns on demand. It reads the same SQLite file the
crawler writes to. **It only reads** — no mutations are exposed.

## What you get

Three tools appear in Claude Desktop's MCP picker once configured:

| Tool              | Purpose                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `list_filters`    | Aggregated `(filterId, featureId)` → `optionIds` universe from the DB. |
| `search_listings` | Multi-criteria query returning clickable `https://999.md/ro/<id>` URLs.  |
| `get_listing`     | Full record + filter triples for one listing.                          |

Results are returned as structured JSON so Claude Desktop's analysis tool can
chart them directly (price-vs-area scatter, district heatmaps, etc.).

## Build the server

```bash
pnpm build
```

This produces `dist/mcp/server.js`. The compiled binary is what Claude Desktop
will execute.

## Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS — adjust per platform) and add:

```json
{
  "mcpServers": {
    "house-track": {
      "command": "node",
      "args": ["/Users/egorg/Dev/house-track/house-track/dist/mcp/server.js"],
      "env": {
        "DATABASE_URL": "file:/Users/egorg/Dev/house-track/house-track/data/dev.db"
      }
    }
  }
}
```

Restart Claude Desktop. The three tools should appear under the MCP picker.

## Local iteration without rebuilding

For development, run the tsx-watched form directly:

```bash
DATABASE_URL=file:./data/dev.db pnpm mcp
```

This is useful when iterating on `src/mcp/queries.ts` — but Claude Desktop
itself spawns the **compiled** binary, so any change still requires
`pnpm build` before Desktop sees it.

## Example prompts

- "List all distinct filters you have observed in the DB."
- "Show me the 10 cheapest houses under 100k EUR with at least 3 rooms."
- "Plot price vs. area for everything in Botanica under 150k."
- "What's the median price per square meter by district?"

The crawler must have run at least once to populate the DB (otherwise the
queries return empty arrays).

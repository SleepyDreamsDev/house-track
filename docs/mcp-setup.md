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

```bash
pnpm setup:mcp           # write the config; merges, doesn't clobber other servers
pnpm setup:mcp --dry-run # preview the merged file without writing
```

The script writes `~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS, reads `DATABASE_URL` from your `.env` (falling back to
`.env.example`), and points `args[0]` at `dist/mcp/server.js`. It is
idempotent — re-running just overwrites the `house-track` entry and leaves
any other MCP servers untouched.

Restart Claude Desktop. The three tools should appear under the MCP picker.

### Manual fallback (Linux/Windows or no pnpm)

Edit the config by hand. macOS path is shown above; on Linux/Windows, see
the Anthropic docs for the OS-specific path. Add:

```json
{
  "mcpServers": {
    "house-track": {
      "command": "node",
      "args": ["/absolute/path/to/house-track/dist/mcp/server.js"],
      "env": {
        "DATABASE_URL": "postgresql://house_track:changeme@127.0.0.1:5432/house_track"
      }
    }
  }
}
```

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

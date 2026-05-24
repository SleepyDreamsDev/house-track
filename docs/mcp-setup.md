# Wiring `house-track` into Claude Desktop

The `house-track-mcp` server is a local stdio Model Context Protocol process
that Claude Desktop spawns on demand. It reads the PostgreSQL database the
crawler writes to. **It only reads** — no mutations are exposed.

## What you get

Tools and one resource appear in Claude Desktop's MCP picker once configured:

| Tool / resource        | Purpose                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `list_filters`         | Aggregated `(filterId, featureId)` → `optionIds` universe from the DB.   |
| `search_listings`      | Multi-criteria query returning clickable `https://999.md/ro/<id>` URLs.  |
| `get_listing`          | Full record + filter triples for one listing.                            |
| `run_sql`              | One guarded read-only `SELECT` for open-ended questions (see below).     |
| `schema://house-track` | The Prisma schema as a resource — read it to compose `run_sql` queries.  |

Results are returned as structured JSON so Claude Desktop's analysis tool can
chart them directly (price-vs-area scatter, district heatmaps, etc.).

### `run_sql` — "ask the data"

`run_sql` lets Claude compose an arbitrary read-only query instead of you
hand-coding a report. It is guarded by defense in depth:

- **Database role.** It connects as `house_track_ro` (SELECT only), so writes
  are impossible at the database level — the hard backstop.
- **App validation.** Only a single `SELECT` / `WITH … SELECT` is accepted;
  multiple statements and non-SELECT are rejected. Results are capped at 500
  rows / ~100 KB (the envelope reports `truncated`), and a 5s `statement_timeout`
  kills runaway queries.
- **Caching.** Identical queries are served from an in-memory cache keyed to the
  latest completed sweep, so re-asking the same question doesn't re-hit the DB.

If `DATABASE_URL_RO` is not set, `run_sql` reports "not configured" and the
other three tools keep working.

#### Create the read-only role

On first `docker compose up` the role is created automatically (see
`scripts/init-ro-role.sh`, driven by `RO_PASSWORD`). For an existing database,
run it by hand:

```bash
psql "$DATABASE_URL" -v ro_password='changeme_ro' -f scripts/create-ro-role.sql
```

Then set `DATABASE_URL_RO` (and `RO_PASSWORD`) in your `.env` — see
`.env.example`.

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
on macOS, reads `DATABASE_URL` (and, if present, `DATABASE_URL_RO` to enable
`run_sql`) from your `.env` (falling back to `.env.example`), and points
`args[0]` at `dist/mcp/server.js`. It is idempotent — re-running just overwrites
the `house-track` entry and leaves any other MCP servers untouched.

Restart Claude Desktop. The tools should appear under the MCP picker.

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
        "DATABASE_URL": "postgresql://house_track:changeme@127.0.0.1:5432/house_track",
        "DATABASE_URL_RO": "postgresql://house_track_ro:changeme_ro@127.0.0.1:5432/house_track"
      }
    }
  }
}
```

## Local iteration without rebuilding

For development, run the tsx form directly (reads `DATABASE_URL` /
`DATABASE_URL_RO` from the environment):

```bash
pnpm mcp
```

This is useful when iterating on `src/mcp/queries.ts` or `src/mcp/sql-runner.ts`
— but Claude Desktop itself spawns the **compiled** binary, so any change still
requires `pnpm build` before Desktop sees it.

## Example prompts

- "List all distinct filters you have observed in the DB."
- "Show me the 10 cheapest houses under 100k EUR with at least 3 rooms."
- "Plot price vs. area for everything in Botanica under 150k."
- "What's the median price per square meter by district?" (run_sql shines here)
- "Using run_sql, find listings whose price dropped since last month, by district."

The crawler must have run at least once to populate the DB (otherwise the
queries return empty arrays).

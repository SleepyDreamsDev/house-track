// scripts/setup-mcp.ts
//
// Writes the house-track MCP server entry into Claude Desktop's config,
// merging with any existing servers. Idempotent. macOS only for the POC.
//
// Usage:
//   pnpm setup:mcp              # write config
//   pnpm setup:mcp --dry-run    # print merged config to stdout, don't write
//
// Reads DATABASE_URL from the project's .env (falling back to .env.example
// for fresh checkouts). Refuses if dist/mcp/server.js is missing — run
// `pnpm build` first.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_JS = join(REPO_ROOT, 'dist/mcp/server.js');
const CONFIG_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'Claude',
  'claude_desktop_config.json',
);
const SERVER_KEY = 'house-track';

interface ClaudeConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [k: string]: unknown;
}

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  if (process.platform !== 'darwin') {
    console.error(
      `✗ This script targets macOS (Claude Desktop config path is hardcoded).\n  Detected platform: ${process.platform}\n  See docs/mcp-setup.md for manual setup on other platforms.`,
    );
    process.exit(1);
  }

  if (!existsSync(SERVER_JS)) {
    console.error(`✗ ${SERVER_JS} not found.\n  Run \`pnpm build\` first.`);
    process.exit(1);
  }

  const databaseUrl = await resolveDatabaseUrl();
  const entry: McpServerEntry = {
    command: 'node',
    args: [SERVER_JS],
    env: { DATABASE_URL: databaseUrl },
  };

  const existing = await loadConfig();
  const merged: ClaudeConfig = {
    ...existing,
    mcpServers: { ...(existing.mcpServers ?? {}), [SERVER_KEY]: entry },
  };

  const serialized = `${JSON.stringify(merged, null, 2)}\n`;

  if (dryRun) {
    console.error(`(dry-run) would write ${CONFIG_PATH}:`);
    process.stdout.write(serialized);
    return;
  }

  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, serialized, 'utf8');

  const otherKeys = Object.keys(merged.mcpServers ?? {}).filter((k) => k !== SERVER_KEY);
  console.error(`✓ wrote ${CONFIG_PATH}`);
  console.error(`  mcpServers.${SERVER_KEY}.args[0] = ${SERVER_JS}`);
  console.error(`  mcpServers.${SERVER_KEY}.env.DATABASE_URL = ${redact(databaseUrl)}`);
  if (otherKeys.length > 0) {
    console.error(`  other servers preserved: ${otherKeys.join(', ')}`);
  }
  console.error('\n→ Restart Claude Desktop to pick up changes.');
}

async function resolveDatabaseUrl(): Promise<string> {
  for (const fname of ['.env', '.env.local', '.env.example']) {
    const path = join(REPO_ROOT, fname);
    if (!existsSync(path)) continue;
    const value = parseDotenv(await readFile(path, 'utf8'))['DATABASE_URL'];
    if (value) return value;
  }
  throw new Error(
    `DATABASE_URL not found in .env, .env.local, or .env.example.\n  Set it in .env (e.g. \`postgresql://house_track:changeme@127.0.0.1:5432/house_track\`).`,
  );
}

function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

async function loadConfig(): Promise<ClaudeConfig> {
  if (!existsSync(CONFIG_PATH)) return {};
  const raw = await readFile(CONFIG_PATH, 'utf8');
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as ClaudeConfig;
  } catch (err) {
    throw new Error(
      `Failed to parse ${CONFIG_PATH} as JSON: ${err instanceof Error ? err.message : String(err)}\n  Fix the file by hand or move it aside, then re-run.`,
    );
  }
}

function redact(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
}

main().catch((err: unknown) => {
  console.error(`✗ setup-mcp failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

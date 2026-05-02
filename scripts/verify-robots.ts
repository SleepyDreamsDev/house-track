// scripts/verify-robots.ts
//
// Programmatically verifies that the URLs the crawler actually fetches are
// permitted by https://999.md/robots.txt for `User-agent: *`. The crawler
// only POSTs to /graphql; /ro/<id> URLs are stored as references for human
// clicks and never fetched.
//
// Usage:
//   pnpm verify-robots
//
// Exits 0 if all required paths are allowed; 1 otherwise.

import { POLITENESS } from '../src/config.js';
import { isPathAllowedForStar, parseRobots } from './lib/robots.js';

const ROBOTS_URL = 'https://999.md/robots.txt';
const REQUIRED_PATHS = [
  '/graphql',
  '/ro/list/real-estate/houses-and-villas',
  '/ro/103772337',
] as const;

async function main(): Promise<void> {
  const res = await fetch(ROBOTS_URL, {
    headers: { 'User-Agent': POLITENESS.userAgent },
  });
  if (!res.ok) {
    console.error(`✗ ${ROBOTS_URL} returned ${res.status}`);
    process.exit(1);
  }
  const body = await res.text();
  const rules = parseRobots(body);

  console.log(`fetched: ${ROBOTS_URL} (${body.length} bytes)`);
  console.log(`User-agent: * disallow rules (${rules.starDisallows.length}):`);
  for (const r of rules.starDisallows) console.log(`  - ${r}`);
  console.log('');

  let ok = true;
  for (const path of REQUIRED_PATHS) {
    const allowed = isPathAllowedForStar(rules, path);
    console.log(`${allowed ? '✓' : '✗'} ${path}`);
    if (!allowed) ok = false;
  }

  if (!ok) {
    console.error('\nrobots.txt blocks one or more crawler paths. Aborting.');
    process.exit(1);
  }
  console.log('\nAll required paths are permitted.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

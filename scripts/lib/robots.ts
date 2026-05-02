// Minimal robots.txt parser for our single-bot, single-host crawl.
//
// Scope: enough to answer "is this path allowed for User-agent: *?" against
// 999.md. Not a general-purpose RFC 9309 implementation — no Allow rules,
// no crawl-delay, no sitemap parsing, no UA-globbing beyond exact match.

export interface RobotsRules {
  starDisallows: readonly string[];
}

export function parseRobots(text: string): RobotsRules {
  const lines = text.split(/\r?\n/);
  const groups = new Map<string, string[]>();
  let currentAgents: string[] = [];

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const directive = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (directive === 'user-agent') {
      currentAgents = [value];
      if (!groups.has(value)) groups.set(value, []);
      continue;
    }

    if (directive === 'disallow' && value !== '') {
      for (const agent of currentAgents) {
        const arr = groups.get(agent);
        if (arr) arr.push(value);
      }
    }
  }

  return { starDisallows: groups.get('*') ?? [] };
}

export function isPathAllowedForStar(rules: RobotsRules, path: string): boolean {
  for (const pattern of rules.starDisallows) {
    if (matchesRobotsPattern(pattern, path)) return false;
  }
  return true;
}

function matchesRobotsPattern(pattern: string, path: string): boolean {
  // Convert robots.txt globs (`*` = any chars, `$` = end) to a RegExp.
  // We don't need to escape much because robots paths are URL-shaped.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + escaped.replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return re.test(path);
}

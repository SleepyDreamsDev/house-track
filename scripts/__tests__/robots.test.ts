import { describe, expect, it } from 'vitest';

import { isPathAllowedForStar, parseRobots } from '../lib/robots.js';

const SAMPLE = `User-agent: Googlebot
Disallow: /api/

User-agent: *
Disallow: */search?query=
Disallow: /market/
Disallow: /api/
Disallow: /companies/
Disallow: *?store
#Disallow: *?view_type
Disallow: /999.md.html
`;

describe('parseRobots', () => {
  it('extracts disallow rules for User-agent: *', () => {
    const rules = parseRobots(SAMPLE);
    expect(rules.starDisallows).toEqual([
      '*/search?query=',
      '/market/',
      '/api/',
      '/companies/',
      '*?store',
      '/999.md.html',
    ]);
  });

  it('ignores commented-out lines', () => {
    const rules = parseRobots(SAMPLE);
    expect(rules.starDisallows).not.toContain('*?view_type');
  });

  it('ignores rules under other user-agents', () => {
    const rules = parseRobots('User-agent: Googlebot\nDisallow: /everything/\n');
    expect(rules.starDisallows).toEqual([]);
  });
});

describe('isPathAllowedForStar', () => {
  const rules = parseRobots(SAMPLE);

  it('allows /graphql (not in disallow list)', () => {
    expect(isPathAllowedForStar(rules, '/graphql')).toBe(true);
  });

  it('allows /ro/<id> listing reference URLs', () => {
    expect(isPathAllowedForStar(rules, '/ro/103772337')).toBe(true);
  });

  it('blocks exact prefix match /api/...', () => {
    expect(isPathAllowedForStar(rules, '/api/foo')).toBe(false);
  });

  it('blocks /market/ prefix', () => {
    expect(isPathAllowedForStar(rules, '/market/anything')).toBe(false);
  });

  it('blocks paths matching wildcard *?store', () => {
    expect(isPathAllowedForStar(rules, '/ro/list?store=1')).toBe(false);
  });

  it('blocks paths matching wildcard */search?query=', () => {
    expect(isPathAllowedForStar(rules, '/ro/list/search?query=foo')).toBe(false);
  });
});

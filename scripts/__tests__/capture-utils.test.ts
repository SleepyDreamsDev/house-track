import { describe, expect, it } from 'vitest';

import {
  classifyHeader,
  diffVariables,
  formatCookieEnv,
  headersMarkdownTable,
  looksLikeTaxonomyOpName,
  parseArgs,
  replaceQueryBody,
  trimSearchAdsResponse,
} from '../lib/capture-utils.js';

describe('parseArgs', () => {
  it('Defaults to headed browser with 30s challenge timeout', () => {
    expect(parseArgs([])).toEqual({ headless: false, timeoutMs: 30_000, taxonomyOp: null });
  });

  it('--headless flag flips browser to headless mode', () => {
    expect(parseArgs(['--headless']).headless).toBe(true);
  });

  it('--timeout overrides the default challenge wait', () => {
    expect(parseArgs(['--timeout', '60000']).timeoutMs).toBe(60_000);
  });

  it('--taxonomy-op pins which operationName counts as the taxonomy capture', () => {
    expect(parseArgs(['--taxonomy-op', 'SearchFilters']).taxonomyOp).toBe('SearchFilters');
  });

  it('--taxonomy-op rejects non-alphanumeric names', () => {
    expect(() => parseArgs(['--taxonomy-op', 'Bad-Name'])).toThrow(/taxonomy-op/i);
  });

  it('Unknown flag aborts with a helpful error', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/--nope/);
  });

  it('Numeric --timeout values must be positive integers', () => {
    expect(() => parseArgs(['--timeout', 'abc'])).toThrow(/timeout/i);
  });
});

describe('looksLikeTaxonomyOpName', () => {
  it.each([
    ['SearchFilters', true],
    ['GetFilters', true],
    ['CategoryFilters', true],
    ['Filters', true],
    ['Taxonomy', true],
  ] as const)('%s is treated as a taxonomy candidate', (name, expected) => {
    expect(looksLikeTaxonomyOpName(name)).toBe(expected);
  });

  it.each([
    ['SearchAds', false],
    ['GetAdvert', false],
    ['SearchSuggestions', false],
    ['Login', false],
  ] as const)('%s is rejected as a candidate', (name, expected) => {
    expect(looksLikeTaxonomyOpName(name)).toBe(expected);
  });
});

describe('classifyHeader', () => {
  it.each([
    ['cookie', 'per-request'],
    ['Cookie', 'per-request'],
    ['Authorization', 'per-request'],
    ['x-csrf-token', 'per-request'],
    ['X-XSRF-TOKEN', 'per-request'],
  ] as const)('%s is per-request', (name, expected) => {
    expect(classifyHeader(name)).toBe(expected);
  });

  it.each([
    ['accept-language', 'static'],
    ['sec-fetch-site', 'static'],
    ['user-agent', 'static'],
    ['origin', 'static'],
  ] as const)('%s is static', (name, expected) => {
    expect(classifyHeader(name)).toBe(expected);
  });
});

const SAMPLE_GRAPHQL_TS = `import { FILTER } from './config.js';

// REPLACE-ME: paste the real \`query SearchAds(...) { ... }\` body.
export const SEARCH_ADS_QUERY = \`query SearchAds($input: SearchInput!) {
  searchAds(input: $input) { ads { id } count }
}\`;

// REPLACE-ME: paste the real \`query GetAdvert(...) { ... }\` body.
export const GET_ADVERT_QUERY = \`query GetAdvert($input: AdvertInput!) {
  advert(input: $input) { id title }
}\`;

// REPLACE-ME — populated by capture-session.
export const FILTER_TAXONOMY_QUERY = \`query FilterTaxonomy { __typename }\`;
`;

const NEW_SEARCH_QUERY =
  'query SearchAds($input: SearchInput!) {\n  searchAds(input: $input) {\n    ads { id title price { value { value } } }\n    count\n  }\n}';

const NEW_ADVERT_QUERY =
  'query GetAdvert($input: AdvertInput!) {\n  advert(input: $input) {\n    id\n    title\n    body { value { ro } }\n  }\n}';

describe('replaceQueryBody', () => {
  const ts = '2026-05-01T12:00:00Z';

  it('Replaces SEARCH_ADS_QUERY body and updates the REPLACE-ME marker', () => {
    const out = replaceQueryBody(SAMPLE_GRAPHQL_TS, 'SEARCH_ADS_QUERY', NEW_SEARCH_QUERY, ts);

    expect(out).toContain(NEW_SEARCH_QUERY);
    expect(out).toContain(`// CAPTURED ${ts} by scripts/capture-session.ts`);
    // GET_ADVERT_QUERY block must not be touched.
    expect(out).toContain('advert(input: $input) { id title }');
  });

  it('Replaces GET_ADVERT_QUERY without touching SEARCH_ADS_QUERY', () => {
    const out = replaceQueryBody(SAMPLE_GRAPHQL_TS, 'GET_ADVERT_QUERY', NEW_ADVERT_QUERY, ts);

    expect(out).toContain(NEW_ADVERT_QUERY);
    expect(out).toContain('searchAds(input: $input) { ads { id } count }');
  });

  it('Drops the original template body', () => {
    const out = replaceQueryBody(SAMPLE_GRAPHQL_TS, 'SEARCH_ADS_QUERY', NEW_SEARCH_QUERY, ts);

    expect(out).not.toContain('searchAds(input: $input) { ads { id } count }');
  });

  it('Refuses captured strings whose operation does not match', () => {
    expect(() =>
      replaceQueryBody(SAMPLE_GRAPHQL_TS, 'SEARCH_ADS_QUERY', NEW_ADVERT_QUERY, ts),
    ).toThrow(/SearchAds/);
  });

  it('Refuses when the export cannot be located', () => {
    expect(() =>
      replaceQueryBody('export const OTHER = `x`;', 'SEARCH_ADS_QUERY', NEW_SEARCH_QUERY, ts),
    ).toThrow(/SEARCH_ADS_QUERY/);
  });

  it('FILTER_TAXONOMY_QUERY accepts any `query <Name>(` body (op name unknown a priori)', () => {
    const TAXONOMY_BODY =
      'query SearchFilters($input: FilterInput!) {\n  searchFilters(input: $input) { id label }\n}';
    const out = replaceQueryBody(SAMPLE_GRAPHQL_TS, 'FILTER_TAXONOMY_QUERY', TAXONOMY_BODY, ts);
    expect(out).toContain(TAXONOMY_BODY);
    expect(out).not.toContain('query FilterTaxonomy { __typename }');
  });

  it('FILTER_TAXONOMY_QUERY refuses bodies that do not start with `query <Name>(`', () => {
    expect(() =>
      replaceQueryBody(SAMPLE_GRAPHQL_TS, 'FILTER_TAXONOMY_QUERY', 'mutation Foo { x }', ts),
    ).toThrow(/FILTER_TAXONOMY_QUERY/);
  });

  it('Re-running replacement is idempotent (CAPTURED marker not duplicated)', () => {
    const once = replaceQueryBody(SAMPLE_GRAPHQL_TS, 'SEARCH_ADS_QUERY', NEW_SEARCH_QUERY, ts);
    const twice = replaceQueryBody(once, 'SEARCH_ADS_QUERY', NEW_SEARCH_QUERY, ts);

    const matches = twice.match(/CAPTURED .* by scripts\/capture-session\.ts/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe('trimSearchAdsResponse', () => {
  it('Keeps only the first N ads but preserves count', () => {
    const json = {
      data: {
        searchAds: {
          ads: Array.from({ length: 78 }, (_, i) => ({ id: String(i) })),
          count: 3302,
        },
      },
    };

    const trimmed = trimSearchAdsResponse(json, 5);

    expect(trimmed.data.searchAds.ads).toHaveLength(5);
    expect(trimmed.data.searchAds.ads[0]).toEqual({ id: '0' });
    expect(trimmed.data.searchAds.count).toBe(3302);
  });

  it('Throws if the JSON shape is unexpected', () => {
    expect(() => trimSearchAdsResponse({ data: {} } as unknown, 5)).toThrow(/searchAds/);
  });
});

describe('diffVariables', () => {
  it('Reports no drift when shapes match', () => {
    const captured = { input: { subCategoryId: 1406, limit: 78, skip: 0 } };
    const expected = { input: { subCategoryId: 1406, limit: 78, skip: 0 } };

    expect(diffVariables(captured, expected)).toEqual({ ok: true, messages: [] });
  });

  it('Flags fields the capture has but the builder does not produce', () => {
    const captured = { input: { subCategoryId: 1406 }, version: 2 };
    const expected = { input: { subCategoryId: 1406 } };

    const result = diffVariables(captured, expected);

    expect(result.ok).toBe(false);
    expect(result.messages.join('\n')).toMatch(/version/);
  });

  it('Flags fields the builder produces but the capture lacks', () => {
    const captured = { input: { subCategoryId: 1406 } };
    const expected = { input: { subCategoryId: 1406, limit: 78 } };

    const result = diffVariables(captured, expected);

    expect(result.ok).toBe(false);
    expect(result.messages.join('\n')).toMatch(/limit/);
  });

  it('Treats different primitive values as drift', () => {
    const result = diffVariables({ input: { skip: 0 } }, { input: { skip: 1 } });

    expect(result.ok).toBe(false);
    expect(result.messages.join('\n')).toMatch(/skip/);
  });
});

describe('formatCookieEnv', () => {
  it('Joins cookie pairs and quotes the value', () => {
    const out = formatCookieEnv([
      { name: 'cf_clearance', value: 'abc' },
      { name: '__cf_bm', value: 'xyz' },
    ]);

    expect(out).toBe('BOOTSTRAP_COOKIES="cf_clearance=abc; __cf_bm=xyz"');
  });

  it('Escapes embedded double quotes', () => {
    const out = formatCookieEnv([{ name: 'weird', value: 'has"quote' }]);

    expect(out).toContain('has\\"quote');
  });

  it('Returns BOOTSTRAP_COOKIES="" for an empty list', () => {
    expect(formatCookieEnv([])).toBe('BOOTSTRAP_COOKIES=""');
  });
});

describe('headersMarkdownTable', () => {
  it('Renders a markdown table with Name, Value, Class columns', () => {
    const out = headersMarkdownTable({
      cookie: 'cf_clearance=abc',
      accept: '*/*',
      'sec-fetch-site': 'same-origin',
    });

    expect(out).toMatch(/\| Name +\| Value +\| Class +\|/);
    expect(out).toMatch(/\| cookie .* per-request +\|/);
    expect(out).toMatch(/\| accept .* static +\|/);
    expect(out).toMatch(/\| sec-fetch-site .* static +\|/);
  });

  it('Sorts rows: per-request first, then static, alphabetical within each group', () => {
    const out = headersMarkdownTable({
      'sec-fetch-site': 'same-origin',
      authorization: 'Bearer x',
      accept: '*/*',
      cookie: 'a=b',
    });

    const rowOrder = out
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.includes('---') && !l.includes('| Name'))
      .map((l) => l.split('|')[1]?.trim());

    expect(rowOrder).toEqual(['authorization', 'cookie', 'accept', 'sec-fetch-site']);
  });
});

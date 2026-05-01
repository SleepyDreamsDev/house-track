import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { applyPostFilter, parseIndex } from '../parse-index.js';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url)) + '/fixtures';

async function loadSearchAds(): Promise<unknown> {
  const raw = await readFile(join(FIXTURE_DIR, 'search-ads-response.json'), 'utf8');
  return JSON.parse(raw);
}

describe('parseIndex', () => {
  it('Returns one stub per ad in the SearchAds response', async () => {
    const json = await loadSearchAds();

    const stubs = parseIndex(json);

    expect(stubs).toHaveLength(5);
  });

  it('Maps id, url and title from each ad', async () => {
    const json = await loadSearchAds();

    const stubs = parseIndex(json);

    expect(stubs[0]).toMatchObject({
      id: '103772337',
      url: 'https://999.md/ro/103772337',
      title: 'Casă,  105 m²,  Chișinău',
    });
  });

  it('Normalizes EUR price to integer and stores raw "<value> EUR"', async () => {
    const json = await loadSearchAds();

    const stubs = parseIndex(json);

    expect(stubs[0]?.priceEur).toBe(108_000);
    expect(stubs[0]?.priceRaw).toBe('108000 EUR');
  });

  it('Parses area in m² from titles like "Casă, 105 m², Chișinău"', async () => {
    const json = await loadSearchAds();

    const stubs = parseIndex(json);

    expect(stubs[0]?.areaSqm).toBe(105);
    expect(stubs[1]?.areaSqm).toBe(300);
  });

  it('Returns areaSqm null when the title has no m² token', async () => {
    const json = await loadSearchAds();

    const stubs = parseIndex(json);

    // 3rd entry: "Chișinău Tohatin str. Bogdan Petriceicu Hașdeu" — no area.
    expect(stubs[2]?.areaSqm).toBeNull();
  });

  it('Sets postedAt to null on stubs (the index "reseted" is bump-time, not post-time)', async () => {
    const json = await loadSearchAds();

    const stubs = parseIndex(json);

    expect(stubs[0]?.postedAt).toBeNull();
  });

  it('Returns priceEur null and a non-null priceRaw when measurement is not EUR', () => {
    const json = {
      data: {
        searchAds: {
          ads: [
            {
              id: '999',
              title: 'Casă,  120 m²,  Chișinău',
              reseted: '26 apr. 2026, 22:00',
              price: {
                value: { measurement: 'UNIT_MDL', unit: 'UNIT_MDL', value: 7_500_000 },
              },
            },
          ],
          count: 1,
        },
      },
    };

    const stubs = parseIndex(json);

    expect(stubs[0]?.priceEur).toBeNull();
    expect(stubs[0]?.priceRaw).toBe('7500000 MDL');
  });

  it('Returns an empty array when the response has no ads', () => {
    const json = { data: { searchAds: { ads: [], count: 0 } } };

    expect(parseIndex(json)).toEqual([]);
  });

  it('Throws when the response shape is broken (no data.searchAds)', () => {
    expect(() => parseIndex({ errors: ['boom'] })).toThrow();
  });
});

describe('applyPostFilter', () => {
  const make = (id: string, priceEur: number | null, areaSqm: number | null) => ({
    id,
    url: `https://999.md/ro/${id}`,
    title: `t${id}`,
    priceEur,
    priceRaw: priceEur === null ? null : `${priceEur} EUR`,
    areaSqm,
    postedAt: null,
  });

  it('Drops listings whose priceEur is over budget', () => {
    const stubs = [make('A', 100_000, 120), make('B', 300_000, 120)];

    const kept = applyPostFilter(stubs, { maxPriceEur: 250_000, maxAreaSqm: 200 });

    expect(kept.map((s) => s.id)).toEqual(['A']);
  });

  it('Drops listings whose areaSqm is over the cap', () => {
    const stubs = [make('A', 100_000, 120), make('B', 100_000, 250)];

    const kept = applyPostFilter(stubs, { maxPriceEur: 250_000, maxAreaSqm: 200 });

    expect(kept.map((s) => s.id)).toEqual(['A']);
  });

  it('Keeps listings with null priceEur (currency unknown — let detail decide)', () => {
    const stubs = [make('A', null, 120)];

    const kept = applyPostFilter(stubs, { maxPriceEur: 250_000, maxAreaSqm: 200 });

    expect(kept.map((s) => s.id)).toEqual(['A']);
  });

  it('Keeps listings with null areaSqm (no area in title — detail page may have it)', () => {
    const stubs = [make('A', 100_000, null)];

    const kept = applyPostFilter(stubs, { maxPriceEur: 250_000, maxAreaSqm: 200 });

    expect(kept.map((s) => s.id)).toEqual(['A']);
  });
});

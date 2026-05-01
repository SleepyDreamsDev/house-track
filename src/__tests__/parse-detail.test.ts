import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AdvertNotFoundError, parseDetail } from '../parse-detail.js';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url)) + '/fixtures';
const ID = '104027607';

async function loadAdvert(): Promise<unknown> {
  const raw = await readFile(join(FIXTURE_DIR, 'advert-detail-response.json'), 'utf8');
  return JSON.parse(raw);
}

describe('parseDetail', () => {
  it('Maps id, url and title from the advert response', async () => {
    const json = await loadAdvert();

    const d = parseDetail(ID, json);

    expect(d.id).toBe(ID);
    expect(d.url).toBe(`https://999.md/ro/${ID}`);
    expect(d.title).toBe('Casă,  140 m²,  Colonița');
  });

  it('Normalizes EUR price and keeps the raw "<value> EUR" string', async () => {
    const json = await loadAdvert();

    const d = parseDetail(ID, json);

    expect(d.priceEur).toBe(395_000);
    expect(d.priceRaw).toBe('395000 EUR');
  });

  it('Parses areaSqm from the title m² token', async () => {
    const json = await loadAdvert();

    expect(parseDetail(ID, json).areaSqm).toBe(140);
  });

  it('Uses the city translation for district (more specific than region)', async () => {
    const json = await loadAdvert();

    expect(parseDetail(ID, json).district).toBe('Colonița');
  });

  it('Maps street from the FEATURE_TEXT value', async () => {
    const json = await loadAdvert();

    expect(parseDetail(ID, json).street).toBe('str. Tohatin');
  });

  it('Uses body.value.ro as the description', async () => {
    const json = await loadAdvert();

    const d = parseDetail(ID, json);

    expect(d.description).toContain('Casă cu un nivel nefinisată');
  });

  it('Maps imageUrls to the raw filenames array', async () => {
    const json = await loadAdvert();

    const d = parseDetail(ID, json);

    expect(d.imageUrls).toEqual([
      '03db25221e0dec3af5bceb71dd0287b9.jpg',
      '34e3ca27e253a3912cf92362e6c25168.jpg',
      'b64225c3feb4fe7ce99eececf531aae9.jpg',
    ]);
  });

  it('Parses bumpedAt from "reseted" using Romanian month abbreviations', async () => {
    const json = await loadAdvert();

    const d = parseDetail(ID, json);

    // "26 apr. 2026, 18:34" → April = month index 3, day 26, 18:34 local
    expect(d.bumpedAt).toBeInstanceOf(Date);
    const bumped = d.bumpedAt as Date;
    expect(bumped.getFullYear()).toBe(2026);
    expect(bumped.getMonth()).toBe(3);
    expect(bumped.getDate()).toBe(26);
    expect(bumped.getHours()).toBe(18);
    expect(bumped.getMinutes()).toBe(34);
  });

  it('Leaves unknown fields null (rooms, landSqm, floors, yearBuilt, heatingType, sellerType, postedAt)', async () => {
    const json = await loadAdvert();

    const d = parseDetail(ID, json);

    expect(d.rooms).toBeNull();
    expect(d.landSqm).toBeNull();
    expect(d.floors).toBeNull();
    expect(d.yearBuilt).toBeNull();
    expect(d.heatingType).toBeNull();
    expect(d.sellerType).toBeNull();
    expect(d.postedAt).toBeNull();
    expect(d.features).toEqual([]);
  });

  it('rawHtmlHash is a sha256 hex string and is stable across irrelevant field changes', async () => {
    const json = (await loadAdvert()) as { data: { advert: Record<string, unknown> } };
    const baseHash = parseDetail(ID, json).rawHtmlHash;

    expect(baseHash).toMatch(/^[0-9a-f]{64}$/);

    // Changing "reseted" (a bump-only timestamp) must not change the hash —
    // we only want snapshots when meaningful content changes.
    json.data.advert.reseted = '27 apr. 2026, 09:00';
    const reHash = parseDetail(ID, json).rawHtmlHash;

    expect(reHash).toBe(baseHash);
  });

  it('rawHtmlHash changes when the price changes', async () => {
    const baseJson = (await loadAdvert()) as {
      data: { advert: { price: { value: { value: number } } } };
    };
    const baseHash = parseDetail(ID, baseJson).rawHtmlHash;

    const bumped = (await loadAdvert()) as {
      data: { advert: { price: { value: { value: number } } } };
    };
    bumped.data.advert.price.value.value = 400_000;

    expect(parseDetail(ID, bumped).rawHtmlHash).not.toBe(baseHash);
  });

  it('Throws when the response is missing data.advert', () => {
    expect(() => parseDetail(ID, { data: {} })).toThrow();
  });

  it('Throws AdvertNotFoundError when advert is null (delisted between index and detail)', () => {
    expect(() => parseDetail(ID, { data: { advert: null } })).toThrow(AdvertNotFoundError);
  });
});
